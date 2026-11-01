'use strict';

const { Timestamp } = require('../config/firebase');

/**
 * Checks whether the bot can work with a chat. Both groups and channels need the bot to be an
 * administrator (channels: to read membership; groups: to approve join requests, which needs
 * the "Invite users" right).
 */
async function checkBotAccess(client, botTelegramId, chatId, { requireInvite = false } = {}) {
  try {
    const chat = await client.getChat({ chat_id: chatId });
    const member = await client.getChatMember({ chat_id: chatId, user_id: botTelegramId });
    const isAdmin = member.status === 'administrator' || member.status === 'creator';
    const canInviteUsers = member.status === 'creator' || member.can_invite_users === true;
    let error = null;
    if (!isAdmin) error = 'The bot must be an administrator of this chat';
    else if (requireInvite && !canInviteUsers) {
      error = 'The bot needs the "Invite users" administrator right to approve join requests';
    }
    return {
      ok: !error,
      title: chat.title || null,
      type: chat.type || null,
      username: chat.username || null,
      status: member.status,
      canInviteUsers,
      error,
    };
  } catch (err) {
    return {
      ok: false,
      title: null,
      type: null,
      username: null,
      status: null,
      canInviteUsers: false,
      error: String(err.description || err.message).slice(0, 200),
    };
  }
}

function toAccess(check) {
  return {
    ok: check.ok,
    status: check.status,
    canInviteUsers: check.canInviteUsers,
    error: check.error,
    checkedAt: Timestamp.now(),
  };
}

module.exports = { checkBotAccess, toAccess };
