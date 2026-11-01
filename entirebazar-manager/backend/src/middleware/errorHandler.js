'use strict';

const { ZodError } = require('zod');
const logger = require('../utils/logger');

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }

  static badRequest(message = 'Bad request', details) {
    return new AppError(400, 'bad_request', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'unauthorized', message);
  }
  static forbidden(message = 'Access denied') {
    return new AppError(403, 'forbidden', message);
  }
  static notFound(message = 'Not found') {
    return new AppError(404, 'not_found', message);
  }
  static conflict(message = 'Conflict') {
    return new AppError(409, 'conflict', message);
  }
}

function notFoundHandler(req, _res, next) {
  next(AppError.notFound('Route not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const requestId = req.id;

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Invalid input',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        requestId,
      },
    });
  }

  // Malformed JSON or oversized body from express.json()
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'invalid_json', message: 'Malformed JSON body', requestId },
    });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'payload_too_large', message: 'Request body too large', requestId },
    });
  }

  if (err && err.name === 'TelegramError') {
    return res.status(502).json({
      error: { code: 'telegram_error', message: err.description || 'Telegram request failed', requestId },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, requestId },
    });
  }

  // Anything else is unexpected: log it, return a generic message.
  logger.error({ err, requestId, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong', requestId },
  });
}

module.exports = { AppError, notFoundHandler, errorHandler };
