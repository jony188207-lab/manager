'use strict';

const env = require('../config/env');
const { db, FieldValue } = require('../config/firebase');
const logger = require('../utils/logger');
const { TELEGRAM_ALLOWED_UPDATES } = require('../utils/constants');
const secrets = require('./secrets');
const { createClient } = require('./telegram');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function invalidate(botId) {
  cache.delete(botId);
}

/** Loads a bot plus its decrypted token. Returns null when the bot or its secret is missing. */
async function getBotWithToken(botId) {
  const hit = cache.get(botId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const [botSnap, secretSnap] = await Promise.all([
    db.collection('bots').doc(botId).get(),
    db.collection('botSecrets').doc(botId).get(),
  ]);
  if (!botSnap.exists || !secretSnap.exists) return null;

  let token;
  try {
    token = secrets.decrypt(secretSnap.data().tokenEnc, botId);
  } catch (_) {
    logger.error({ botId }, 'Failed to decrypt bot token (wrong TOKEN_ENCRYPTION_KEY?)');
    return null;
  }
  const value = { bot: { id: botSnap.id, ...botSnap.data() }, token };
  cache.set(botId, { at: Date.now(), value });
  return value;
}

function webhookUrl(botId) {
  return `${env.PUBLIC_BASE_URL}/webhooks/telegram/${botId}`;
}

async function setWebhookStatus(botId, fields) {
  await db
    .collection('bots')
    .doc(botId)
    .update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
  invalidate(botId);
}

/** Registers this server's webhook URL with Telegram and records the result on the bot document. */
async function syncWebhook(botId, token) {
  const url = webhookUrl(botId);
  if (!url.startsWith('https://')) {
    await setWebhookStatus(botId, {
      webhookStatus: 'error',
      webhookError: 'PUBLIC_BASE_URL must be an https:// URL for Telegram webhooks',
    });
    return;
  }
  try {
    await createClient(token).setWebhook({
      url,
      secret_token: secrets.webhookSecret(botId),
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      max_connections: 40,
    });
    await setWebhookStatus(botId, {
      webhookStatus: 'active',
      webhookError: null,
      webhookUrl: url,
      webhookSyncedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    await setWebhookStatus(botId, {
      webhookStatus: 'error',
      webhookError: String(err.description || err.message).slice(0, 200),
    });
  }
}

/** Removes the webhook (pending updates are kept so nothing is lost while disabled). */
async function removeWebhook(botId, token) {
  try {
    await createClient(token).deleteWebhook({ drop_pending_updates: false });
    await setWebhookStatus(botId, { webhookStatus: 'inactive', webhookError: null });
  } catch (err) {
    await setWebhookStatus(botId, {
      webhookStatus: 'error',
      webhookError: String(err.description || err.message).slice(0, 200),
    });
  }
}

module.exports = { getBotWithToken, invalidate, syncWebhook, removeWebhook, webhookUrl };
