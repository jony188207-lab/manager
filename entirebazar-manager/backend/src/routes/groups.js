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
const { deleteWhere } = require('../services/cleanupService');

const router = express.Router();

router.get(
  '/',
  validate(v.botQuery, 'query'),
  asyncHandler(async (req, res) => {
    const snap = await db.collection('groups').where('botId', '==', req.valid.query.botId).get();
    const groups = snap.docs
      .map(docToJson)
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    res.json({ groups });
  })
);

router.post(
  '/',
  validate(v.groupCreate),
  asyncHandler(async (req, res) => {
    const { botId, chatId, title, inviteLink, enabled } = req.valid.body;
    const bundle = await botService.getBotWithToken(botId);
    if (!bundle) throw AppError.notFound('Bot not found');

    const dup = await db
      .collection('groups')
      .where('botId', '==', botId)
      .where('chatId', '==', chatId)
      .limit(1)
      .get();
    if (!dup.empty) throw AppError.conflict('This group is already configured for this bot');

    const check = await chatService.checkBotAccess(
      createClient(bundle.token),
      bundle.bot.telegramBotId,
      chatId,
      { requireInvite: true }
    );
    const now = FieldValue.serverTimestamp();
    const ref = db.collection('groups').doc();
    await ref.set({
      botId,
      chatId,
      title: title || check.title || chatId,
      type: check.type,
      inviteLink: inviteLink || null,
      enabled,
      botAccess: chatService.toAccess(check),
      createdBy: req.admin.uid,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ group: docToJson(await ref.get()) });
  })
);

router.patch(
  '/:id',
  validate(v.idParam, 'params'),
  validate(v.groupUpdate),
  asyncHandler(async (req, res) => {
    const ref = db.collection('groups').doc(req.valid.params.id);
    if (!(await ref.get()).exists) throw AppError.notFound('Group not found');
    const update = { updatedAt: FieldValue.serverTimestamp() };
    for (const key of ['title', 'inviteLink', 'enabled']) {
      if (req.valid.body[key] !== undefined) update[key] = req.valid.body[key];
    }
    await ref.update(update);
    res.json({ group: docToJson(await ref.get()) });
  })
);

router.post(
  '/:id/check',
  validate(v.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const ref = db.collection('groups').doc(req.valid.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw AppError.notFound('Group not found');
    const group = snap.data();
    const bundle = await botService.getBotWithToken(group.botId);
    if (!bundle) throw AppError.notFound('Bot not found');

    const check = await chatService.checkBotAccess(
      createClient(bundle.token),
      bundle.bot.telegramBotId,
      group.chatId,
      { requireInvite: true }
    );
    const update = { botAccess: chatService.toAccess(check), updatedAt: FieldValue.serverTimestamp() };
    if (check.title) update.title = check.title;
    if (check.type) update.type = check.type;
    await ref.update(update);
    res.json({ group: docToJson(await ref.get()) });
  })
);

router.delete(
  '/:id',
  validate(v.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    const ref = db.collection('groups').doc(id);
    if (!(await ref.get()).exists) throw AppError.notFound('Group not found');
    await deleteWhere('pendingRequests', 'groupId', id);
    await db.collection('verificationSettings').doc(id).delete();
    await ref.delete();
    res.json({ ok: true });
  })
);

module.exports = router;
