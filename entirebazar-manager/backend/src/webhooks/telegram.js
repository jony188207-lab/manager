'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { safeEqual } = require('../utils/crypto');
const secrets = require('../services/secrets');
const botService = require('../services/botService');
const { createClient } = require('../services/telegram');
const verification = require('../services/verificationService');
const { webhookLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

/**
 * POST /webhooks/telegram/:botId
 * Telegram sends the per-bot secret in X-Telegram-Bot-Api-Secret-Token (set via setWebhook).
 * We reply 200 immediately and process the update afterwards, so Telegram never retries
 * slow updates.
 */
router.post('/:botId', webhookLimiter, (req, res) => {
  const { botId } = req.params;
  if (!/^[A-Za-z0-9]{10,40}$/.test(botId)) return res.sendStatus(404);

  const provided = req.get('x-telegram-bot-api-secret-token') || '';
  if (!safeEqual(provided, secrets.webhookSecret(botId))) return res.sendStatus(403);

  const update = req.body;
  if (!update || typeof update.update_id !== 'number') return res.sendStatus(400);

  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const bundle = await botService.getBotWithToken(botId);
      if (!bundle || bundle.bot.enabled !== true) return;
      const ctx = { botId, bot: bundle.bot, client: createClient(bundle.token) };
      await verification.handleUpdate(ctx, update);
    } catch (err) {
      logger.error({ err, botId, updateId: update.update_id }, 'Failed to process Telegram update');
    }
  });
  return undefined;
});

module.exports = router;
