'use strict';

const pino = require('pino');
const env = require('../config/env');
const { scrubSecrets } = require('./redact');

const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-telegram-bot-api-secret-token"]',
      'res.headers["set-cookie"]',
      '*.token',
      '*.botToken',
      '*.password',
      '*.secret',
      '*.webhookSecret',
      '*.privateKey',
      '*.idToken',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err(err) {
      return {
        type: err && err.name,
        message: scrubSecrets(err && err.message),
        code: err && err.code,
        stack: env.isProduction ? undefined : scrubSecrets(err && err.stack),
      };
    },
  },
});

module.exports = logger;
