'use strict';

/** ChatMember.status values that count as "is currently in the chat". */
function isMemberStatus(member) {
  if (!member || typeof member.status !== 'string') return false;
  if (['creator', 'administrator', 'member'].includes(member.status)) return true;
  if (member.status === 'restricted') return member.is_member === true;
  return false; // left, kicked
}

function channelJoinUrl(channel) {
  if (channel.inviteLink) return channel.inviteLink;
  if (channel.username) return `https://t.me/${channel.username}`;
  if (typeof channel.chatId === 'string' && channel.chatId.startsWith('@')) {
    return `https://t.me/${channel.chatId.slice(1)}`;
  }
  return null;
}

function channelTitle(channel) {
  if (channel.title) return channel.title;
  if (channel.username) return `@${channel.username}`;
  return 'Channel';
}

function startLink(botUsername, groupId) {
  return `https://t.me/${botUsername}?start=v_${groupId}`;
}

function isNotModifiedError(err) {
  return Boolean(err && /message is not modified/i.test(err.description || err.message || ''));
}

module.exports = { isMemberStatus, channelJoinUrl, channelTitle, startLink, isNotModifiedError };
