'use strict';

const { z } = require('zod');
const { PLACEMENTS, LOG_EVENTS, ROLES } = require('./constants');

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const numToString = (v) => (typeof v === 'number' ? String(v) : v);
const nonEmpty = (obj) => Object.keys(obj).length > 0;

const id = z.string().regex(/^[A-Za-z0-9]{10,40}$/, 'Invalid id');
const uid = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid uid');

const botToken = z
  .string()
  .trim()
  .regex(/^\d{6,15}:[A-Za-z0-9_-]{30,50}$/, 'Invalid bot token format');

const numericChatId = z.preprocess(
  numToString,
  z.string().trim().regex(/^-?\d{5,20}$/, 'Chat ID must be numeric, e.g. -1001234567890')
);

const channelChatId = z.preprocess(
  numToString,
  z
    .string()
    .trim()
    .regex(
      /^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/,
      'Use a numeric chat ID (-100…) or a public @username'
    )
);

const tmeLink = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(300)
    .regex(/^https:\/\/(t|telegram)\.me\/\S+$/i, 'Must be a https://t.me/ link')
    .nullable()
    .optional()
);

const channelUsername = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .regex(/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/, 'Invalid username')
    .transform((v) => v.replace(/^@/, ''))
    .nullable()
    .optional()
);

function isAllowedUrl(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:', 'tg:'].includes(u.protocol);
  } catch (_) {
    return false;
  }
}
const buttonUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(isAllowedUrl, 'URL must start with https://, http:// or tg://');

const name = z.string().trim().min(1).max(60);
const title = z.string().trim().max(200);
const message = (max = 2000) => z.string().trim().min(1).max(max);
const placement = z.enum(PLACEMENTS);

const timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch (_) {
      return false;
    }
  }, 'Invalid time zone');

const schemas = {
  // route params / query
  idParam: z.object({ id }),
  botIdParam: z.object({ botId: id }),
  groupIdParam: z.object({ groupId: id }),
  uidParam: z.object({ uid }),
  botQuery: z.object({ botId: id }),
  buttonsQuery: z.object({ botId: id, placement: placement.optional() }),
  logsQuery: z.object({
    botId: id.optional(),
    event: z.enum(LOG_EVENTS).optional(),
    userId: z.string().regex(/^\d{1,15}$/, 'User ID must be numeric').optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: id.optional(),
  }),

  // bots
  botCreate: z
    .object({ name, token: botToken, enabled: z.boolean().default(true) })
    .strict(),
  botUpdate: z
    .object({ name: name.optional(), enabled: z.boolean().optional() })
    .strict()
    .refine(nonEmpty, 'Nothing to update'),
  tokenRotate: z.object({ token: botToken }).strict(),

  // groups & channels
  groupCreate: z
    .object({
      botId: id,
      chatId: numericChatId,
      title: title.optional(),
      inviteLink: tmeLink,
      enabled: z.boolean().default(true),
    })
    .strict(),
  groupUpdate: z
    .object({ title: title.optional(), inviteLink: tmeLink, enabled: z.boolean().optional() })
    .strict()
    .refine(nonEmpty, 'Nothing to update'),
  channelCreate: z
    .object({
      botId: id,
      chatId: channelChatId,
      title: title.optional(),
      username: channelUsername,
      inviteLink: tmeLink,
      enabled: z.boolean().default(true),
    })
    .strict()
    .refine(
      (v) => v.inviteLink || v.username || String(v.chatId).startsWith('@'),
      'Provide an invite link or a public username so users can join the channel'
    ),
  channelUpdate: z
    .object({
      title: title.optional(),
      username: channelUsername,
      inviteLink: tmeLink,
      enabled: z.boolean().optional(),
    })
    .strict()
    .refine(nonEmpty, 'Nothing to update'),

  // verification settings (one document per group)
  verificationUpdate: z
    .object({
      enabled: z.boolean(),
      requiredChannelIds: z
        .array(id)
        .max(20)
        .transform((arr) => [...new Set(arr)]),
      verifyButtonText: z.string().trim().min(1).max(40),
      instructionText: message(2000),
      successText: message(1000),
      missingText: message(1500),
      noRequestText: message(1000),
      cooldownSeconds: z.number().int().min(1).max(300),
    })
    .strict()
    .refine(
      (v) => !v.enabled || v.requiredChannelIds.length > 0,
      'Select at least one required channel before enabling verification'
    ),

  // buttons
  buttonCreate: z
    .object({
      botId: id,
      placement,
      label: z.string().trim().min(1).max(64),
      url: buttonUrl,
      row: z.number().int().min(0).max(49).optional(),
      enabled: z.boolean().default(true),
    })
    .strict(),
  buttonUpdate: z
    .object({
      label: z.string().trim().min(1).max(64).optional(),
      url: buttonUrl.optional(),
      enabled: z.boolean().optional(),
    })
    .strict()
    .refine(nonEmpty, 'Nothing to update'),
  buttonLayout: z
    .object({
      botId: id,
      placement,
      items: z
        .array(
          z.object({
            id,
            row: z.number().int().min(0).max(49),
            position: z.number().int().min(0).max(7),
          })
        )
        .min(1)
        .max(100),
    })
    .strict(),

  // welcome messages
  welcomeUpdate: z
    .object({
      groupWelcome: z.object({ enabled: z.boolean(), text: message(2000) }).strict(),
      privateWelcome: z.object({ enabled: z.boolean(), text: message(2000) }).strict(),
    })
    .strict(),

  // admins & settings
  adminCreate: z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      role: z.enum(ROLES).default('admin'),
    })
    .strict(),
  adminUpdate: z
    .object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() })
    .strict()
    .refine(nonEmpty, 'Nothing to update'),
  generalUpdate: z
    .object({
      panelName: name,
      logRetentionDays: z.number().int().min(1).max(365),
      timezone,
    })
    .strict(),
};

module.exports = schemas;
