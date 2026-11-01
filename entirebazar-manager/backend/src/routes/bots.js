'use strict';

const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const { docToJson } = require('../utils/serialize');
const v = require('../utils/validators');
const secrets = require('../services/secrets');
const botService = require('../services/botService');
const { createClient } = require('../services/telegram');
const { deleteWhere } = require('../services/cleanupService');

const router = express.Router();
const botRef = (id) => db.collection('bots').doc(id);

// Bot documents never contain tokens; those live in the backend-only `botSecrets` collection.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const snap = await db.collection('bots').orderBy('createdAt', 'desc').get();
    res.json({ bots: snap.docs.map(docToJson) });
  })
);

router.post(
  '/',
  validate(v.botCreate),
  asyncHandler(async (req, res) => {
    const { name, token, enabled } = req.valid.body;

    let me;
    try {
      me = await createClient(token).getMe();
    } catch (_) {
      throw AppError.badRequest('Telegram rejected this bot token');
    }
    const dup = await db.collection('bots').where('telegramBotId', '==', me.id).limit(1).get();
    if (!dup.empty) throw AppError.conflict('This bot is already registered');

    const ref = db.collection('bots').doc();
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(ref, {
      name,
      username: me.username,
      telegramBotId: me.id,
      enabled,
      webhookStatus: 'inactive',
      webhookError: null,
      createdBy: req.admin.uid,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(db.collection('botSecrets').doc(ref.id), {
      tokenEnc: secrets.encrypt(token, ref.id),
      createdAt: now,
      updatedAt: now,
    });
    await batch.commit();

    if (enabled) await botService.syncWebhook(ref.id, token);
    res.status(201).json({ bot: docToJson(await ref.get()) });
  })
);

router.patch(
  '/:id',
  validate(v.idParam, 'params'),
  validate(v.botUpdate),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    const ref = botRef(id);
    const snap = await ref.get();
    if (!snap.exists) throw AppError.notFound('Bot not found');

    const { name, enabled } = req.valid.body;
    const update = { updatedAt: FieldValue.serverTimestamp() };
    if (name !== undefined) update.name = name;
    if (enabled !== undefined) update.enabled = enabled;
    await ref.update(update);
    botService.invalidate(id);

    if (enabled !== undefined && enabled !== snap.data().enabled) {
      const bundle = await botService.getBotWithToken(id);
      if (!bundle) throw AppError.conflict('Bot token is unavailable; rotate the token first');
      if (enabled) await botService.syncWebhook(id, bundle.token);
      else await botService.removeWebhook(id, bundle.token);
    }
    res.json({ bot: docToJson(await ref.get()) });
  })
);

router.put(
  '/:id/token',
  validate(v.idParam, 'params'),
  validate(v.tokenRotate),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    const { token } = req.valid.body;
    const ref = botRef(id);
    const snap = await ref.get();
    if (!snap.exists) throw AppError.notFound('Bot not found');

    let me;
    try {
      me = await createClient(token).getMe();
    } catch (_) {
      throw AppError.badRequest('Telegram rejected this bot token');
    }
    if (me.id !== snap.data().telegramBotId) {
      throw AppError.badRequest('This token belongs to a different bot');
    }

    const now = FieldValue.serverTimestamp();
    await db.collection('botSecrets').doc(id).set({
      tokenEnc: secrets.encrypt(token, id),
      updatedAt: now,
    }, { merge: true });
    await ref.update({ username: me.username, updatedAt: now });
    botService.invalidate(id);

    if (snap.data().enabled) await botService.syncWebhook(id, token);
    res.json({ bot: docToJson(await ref.get()) });
  })
);

router.post(
  '/:id/webhook',
  validate(v.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    const bundle = await botService.getBotWithToken(id);
    if (!bundle) throw AppError.notFound('Bot not found');
    if (bundle.bot.enabled) await botService.syncWebhook(id, bundle.token);
    else await botService.removeWebhook(id, bundle.token);
    res.json({ bot: docToJson(await botRef(id).get()) });
  })
);

router.get(
  '/:id/webhook-info',
  validate(v.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const bundle = await botService.getBotWithToken(req.valid.params.id);
    if (!bundle) throw AppError.notFound('Bot not found');
    const info = await createClient(bundle.token).getWebhookInfo();
    res.json({
      url: info.url || null,
      pendingUpdateCount: info.pending_update_count || 0,
      lastErrorDate: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
      lastErrorMessage: info.last_error_message || null,
    });
  })
);

router.delete(
  '/:id',
  validate(v.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    const bundle = await botService.getBotWithToken(id);
    if (!bundle) {
      const exists = (await botRef(id).get()).exists;
      if (!exists) throw AppError.notFound('Bot not found');
    } else {
      try {
        await createClient(bundle.token).deleteWebhook({ drop_pending_updates: false });
      } catch (_) {
        /* best effort: continue with local deletion */
      }
    }

    for (const collection of ['groups', 'channels', 'buttons', 'verificationSettings', 'pendingRequests']) {
      await deleteWhere(collection, 'botId', id);
    }
    await db.collection('welcomeMessages').doc(id).delete();
    await db.collection('botSecrets').doc(id).delete();
    await botRef(id).delete();
    botService.invalidate(id);
    res.json({ ok: true });
  })
);

module.exports = router;
