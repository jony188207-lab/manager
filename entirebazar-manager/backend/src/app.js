'use strict';

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./utils/logger');
const { apiLimiter } = require('./middleware/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  // Request id + structured logging (auth headers are redacted in logger config).
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    })
  );

  app.use(helmet());

  // The admin panel is served from a different origin (Firebase Hosting), so allow it explicitly.
  app.use(
    cors({
      origin(origin, cb) {
        // Non-browser callers (Telegram, health checks) send no Origin header.
        if (!origin) return cb(null, true);
        return cb(null, env.CORS_ALLOWED_ORIGINS.includes(origin));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    })
  );

  app.use(express.json({ limit: '100kb' }));

  // Liveness probe for the hosting platform (no auth, no data).
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Telegram webhooks: authenticated by per-bot secret token, not by Firebase.
  app.use('/webhooks/telegram', require('./webhooks/telegram'));

  // Admin API: rate limited, never cached, Firebase token + admin record required.
  app.use('/api', apiLimiter);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', require('./routes'));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
