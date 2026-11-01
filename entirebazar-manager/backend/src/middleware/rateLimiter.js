'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

function tooMany(_req, res) {
  res.status(429).json({
    error: { code: 'rate_limited', message: 'Too many requests, please slow down' },
  });
}

// Admin API: keyed by IP.
const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_API,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany,
});

// Telegram webhooks: separate, more generous bucket per bot and IP.
const webhookLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_WEBHOOK,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.botId || 'unknown'}:${req.ip}`,
  handler: (_req, res) => res.sendStatus(429),
});

module.exports = { apiLimiter, webhookLimiter };
