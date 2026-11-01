'use strict';

const crypto = require('crypto');

/**
 * AES-256-GCM helpers bound to one 32-byte key.
 * - encrypt/decrypt protect bot tokens at rest (aad binds ciphertext to its document id).
 * - webhookSecret derives the per-bot Telegram `secret_token` so it never needs storing.
 */
function createCrypto(keyBase64) {
  const key = Buffer.from(keyBase64 || '', 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64)');

  return {
    encrypt(plaintext, aad = '') {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
      const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      return {
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      };
    },

    decrypt(payload, aad = '') {
      if (!payload || payload.v !== 1) throw new Error('Unsupported ciphertext');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
      if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    },

    webhookSecret(botId) {
      return crypto.createHmac('sha256', key).update(`webhook:${botId}`).digest('hex');
    },
  };
}

/** Constant-time string comparison that does not leak length. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { createCrypto, safeEqual };
