'use strict';

const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const { docToJson } = require('../utils/serialize');
const v = require('../utils/validators');
const botService = require('../services/botService');
const chatService = require('../services/chatService');
const { createClient } = require('../services/telegram');

const router = express.Router();

router.get(
  '/',
  validate(v.botQuery, 'query'),
  asyncHandler(async (req, res) => {
    const snap = await db.collection('channels').where('botId', '==', req.valid.query.botId).get();
    const channels = snap.docs
      .map(docToJson)
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    res.json({ channels });
  })
);

router.post(
  '/',
  validate(v.channelCreate),
  asyncHandler(async (req, res) => {
    const { botId, chatId, title, username, inviteLink, enabled } = req.valid.body;
    const bundle = await botService.getBotWithToken(botId);
    if (!bundle) throw AppError.notFound('Bot not found');

    const dup = await db
      .collection('channels')
      .where('botId', '==', botId)
      .where('chatId', '==', chatId)
      .limit(1)
      .get();
    if (!dup.empty) throw AppError.conflict('This channel is already configured for this bot');

    const check = await chatService.checkBotAccess(
      createClient(bundle.token),
      bundle.bot.telegramBotId,
      chatId
    );
    const now = FieldValue.serverTimestamp();
    const ref = db.collection('channels').doc();
    await ref.set({
      botId,
      chatId,
      title: title || check.title || chatId,
      type: check.type,
      username: username || check.username || null,
      inviteLink: inviteLink || null,
      enabled,
      botAccess: chatService.toAccess(check),
      createdBy: req.admin.uid,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ channel: docToJson(await ref.get()) });
  })
);

router.patch(
  '/:id',
  validate(v.idParam, 'params'),
  validate(v.channelUpdate),
  asyncHandler(async (req, res) => {
    const ref = db.collection('channels').doc(req.valid.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw AppError.notFound('Channel not found');

    const update = { updatedAt: FieldValue.serverTimestamp() };
    for (const key of ['title', 'username', 'inviteLink', 'enabled']) {
      if (req.valid.body[key] !== undefined) update[key] = req.valid.body[key];
    }
    const merged = { ...snap.data(), ...update };
    if (!merged.inviteLink && !merged.username && !String(merged.chatId).startsWith('@')) {
      throw AppError.badRequest('A channel needs an invite link or a public username');
    }
    await ref.update(update);
    res.json({ channel: docToJson(await ref.get()) });
  })
);

router.post(
  '/:id/check',
  validate(v.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const ref = db.collection('channels').doc(req.valid.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw AppError.notFound('Channel not found');
    const channel = snap.data();
    const bundle = await botService.getBotWithToken(channel.botId);
    if (!bundle) throw AppError.notFound('Bot not found');

    const check = await chatService.checkBotAccess(
      createClient(bundle.token),
      bundle.bot.telegramBotId,
      channel.chatId
    );
    const update = { botAccess: chatService.toAccess(check), updatedAt: FieldValue.serverTimestamp() };
    if (check.title) update.title = check.title;
    if (check.type) update.type = check.type;
    await ref.update(update);
    res.json({ channel: docToJson(await ref.get()) });
  })
);

// Deleting a channel also removes it from every group's verification rules.
router.delete(
  '/:id',
  validate(v.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    const ref = db.collection('channels').doc(id);
    if (!(await ref.get()).exists) throw AppError.notFound('Channel not found');

    const rules = await db
      .collection('verificationSettings')
      .where('requiredChannelIds', 'array-contains', id)
      .get();
    const batch = db.batch();
    rules.docs.forEach((d) => {
      const remaining = d.data().requiredChannelIds.filter((c) => c !== id);
      batch.update(d.ref, {
        requiredChannelIds: remaining,
        enabled: remaining.length ? d.data().enabled : false,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    batch.delete(ref);
    await batch.commit();
    res.json({ ok: true });
  })
);

module.exports = router;
