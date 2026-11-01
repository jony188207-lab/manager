'use strict';

// Telegram bot tokens look like 123456789:AAH... (digits, colon, 30+ url-safe chars).
const BOT_TOKEN_RE = /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

function scrubSecrets(input) {
  if (typeof input !== 'string') return input;
  return input.replace(BOT_TOKEN_RE, '[REDACTED_BOT_TOKEN]').replace(BEARER_RE, 'Bearer [REDACTED]');
}

module.exports = { scrubSecrets };
