'use strict';

const { db, FieldValue } = require('../config/firebase');
const logger = require('../utils/logger');

/** Appends an entry to verificationLogs. Never throws: logging must not break verification. */
async function writeLog(entry) {
  try {
    await db.collection('verificationLogs').add({
      botId: entry.botId,
      botName: entry.botName || null,
      groupId: entry.groupId || null,
      chatId: entry.chatId ? String(entry.chatId) : null,
      userId: entry.userId ? String(entry.userId) : null,
      username: entry.username || null,
      firstName: entry.firstName || null,
      event: entry.event,
      status: entry.status || 'info',
      detail: entry.detail ? String(entry.detail).slice(0, 500) : null,
      missingChannelIds: entry.missingChannelIds || [],
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write verification log');
  }
}

module.exports = { writeLog };
