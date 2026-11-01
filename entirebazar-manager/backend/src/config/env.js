'use strict';

require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  PUBLIC_BASE_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, '')),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),

  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'must be 32 random bytes encoded as base64',
    }),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX_API: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_MAX_WEBHOOK: z.coerce.number().int().min(1).default(600),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Print variable names and reasons only, never the values.
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${problems}`);
    process.exit(1);
  }
  const env = parsed.data;
  env.isProduction = env.NODE_ENV === 'production';
  return Object.freeze(env);
}

module.exports = loadEnv();
