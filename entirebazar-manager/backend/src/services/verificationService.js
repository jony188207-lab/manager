'use strict';

const { db, FieldValue, Timestamp } = require('../config/firebase');
const logger = require('../utils/logger');
const { DEFAULT_VERIFICATION_SETTINGS, DEFAULT_WELCOME } = require('../utils/defaults');
const { buildInlineKeyboard, renderTemplate } = require('../utils/keyboard');
const {
  isMemberStatus,
  channelJoinUrl,
  channelTitle,
  startLink,
  isNotModifiedError,
} = require('../utils/telegramHelpers');
const { writeLog } = require('./logService');

const noPreview = { is_disabled: true };
const pendingRef = (groupId, userId) => db.collection('pendingRequests').doc(`${groupId}_${userId}`);
const markup = (keyboard) => (keyboard.inline_keyboard.length ? keyboard : undefined);

/** Runs a best-effort Telegram call; failures are logged, never thrown. */
async function attempt(label, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, label }, 'Telegram call failed');
    return undefined;
  }
}

// ---------- data loaders ----------

async function getGroup(groupId) {
  const snap = await db.collection('groups').doc(groupId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function findGroupByChat(botId, chatId) {
  const snap = await db
    .collection('groups')
    .where('botId', '==', botId)
    .where('chatId', '==', chatId)
    .limit(1)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function loadSettings(groupId) {
  const snap = await db.collection('verificationSettings').doc(groupId).get();
  return { ...DEFAULT_VERIFICATION_SETTINGS, ...(snap.exists ? snap.data() : {}) };
}

async function loadRequiredChannels(botId, ids) {
  if (!ids || !ids.length) return [];
  const snaps = await db.getAll(...ids.map((i) => db.collection('channels').doc(i)));
  return snaps
    .filter((s) => s.exists && s.data().botId === botId && s.data().enabled !== false)
    .map((s) => ({ id: s.id, ...s.data() }));
}

async function loadButtons(botId, placement) {
  const snap = await db
    .collection('buttons')
    .where('botId', '==', botId)
    .where('placement', '==', placement)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadWelcome(botId) {
  const snap = await db.collection('welcomeMessages').doc(botId).get();
  const data = snap.exists ? snap.data() : {};
  return {
    groupWelcome: { ...DEFAULT_WELCOME.groupWelcome, ...(data.groupWelcome || {}) },
    privateWelcome: { ...DEFAULT_WELCOME.privateWelcome, ...(data.privateWelcome || {}) },
  };
}

// ---------- message building ----------

function varsFor(ctx, group, user, extra = {}) {
  const first = user.first_name || 'there';
  return {
    first_name: first,
    username: user.username ? `@${user.username}` : first,
    group_title: (group && group.title) || 'the group',
    bot_username: ctx.bot.username ? `@${ctx.bot.username}` : '',
    ...extra,
  };
}

/** Verification instructions: channel join buttons, extra admin buttons, then the Verify button. */
async function buildInstruction(ctx, { group, settings, channels, user, missing }) {
  const shown = missing || channels;
  const names = shown.map((c) => `• ${channelTitle(c)}`).join('\n');
  const vars = varsFor(ctx, group, user, { channels: names, missing_channels: names });
  let text = renderTemplate(missing ? settings.missingText : settings.instructionText, vars);
  if (!missing) text += `\n\nRequired channels:\n${names}`;

  const extra = await loadButtons(ctx.botId, 'verification');
  const before = shown
    .map((c) => ({ c, url: channelJoinUrl(c) }))
    .filter((x) => x.url)
    .map((x) => [{ text: `📢 ${channelTitle(x.c)}`, url: x.url }]);
  const after = [[{ text: settings.verifyButtonText, callback_data: `v:${group.id}` }]];

  return {
    text: text.slice(0, 4096),
    reply_markup: buildInlineKeyboard({ before, buttons: extra, after }),
  };
}

async function sendInstruction(ctx, chatId, args) {
  const msg = await buildInstruction(ctx, args);
  return ctx.client.sendMessage({
    chat_id: chatId,
    text: msg.text,
    reply_markup: msg.reply_markup,
    link_preview_options: noPreview,
  });
}

// ---------- membership & approval ----------

async function checkMembership(ctx, channels, userId) {
  const results = await Promise.allSettled(
    channels.map((c) => ctx.client.getChatMember({ chat_id: c.chatId, user_id: userId }))
  );
  const missing = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (!isMemberStatus(r.value)) missing.push(channels[i]);
      return;
    }
    const description = (r.reason && r.reason.description) || '';
    if (/user not found|PARTICIPANT_ID_INVALID/i.test(description)) missing.push(channels[i]);
    else errors.push({ channel: channels[i], error: description || 'unknown error' });
  });
  return { missing, errors };
}

async function approveRequest(ctx, group, user) {
  try {
    await ctx.client.approveChatJoinRequest({ chat_id: group.chatId, user_id: user.id });
    return 'approved';
  } catch (err) {
    const d = err.description || '';
    if (/USER_ALREADY_PARTICIPANT/i.test(d)) return 'already_member';
    if (/HIDE_REQUESTER_MISSING|USER_ID_INVALID/i.test(d)) return 'no_request';
    throw err;
  }
}

/**
 * Group welcome: a normal message in the group, visible to EVERY member. Telegram cannot show a
 * group message to one person only. Private messages are handled by sendPrivateWelcome.
 */
async function sendGroupWelcome(ctx, group, user) {
  const welcome = await loadWelcome(ctx.botId);
  if (!welcome.groupWelcome.enabled) return;
  const buttons = await loadButtons(ctx.botId, 'welcome');
  await ctx.client.sendMessage({
    chat_id: group.chatId,
    text: renderTemplate(welcome.groupWelcome.text, varsFor(ctx, group, user)),
    reply_markup: markup(buildInlineKeyboard({ buttons })),
    link_preview_options: noPreview,
  });
}

async function sendPrivateWelcome(ctx, msg) {
  const welcome = await loadWelcome(ctx.botId);
  if (!welcome.privateWelcome.enabled) return;
  const buttons = await loadButtons(ctx.botId, 'welcome');
  await ctx.client.sendMessage({
    chat_id: msg.chat.id,
    text: renderTemplate(welcome.privateWelcome.text, varsFor(ctx, null, msg.from)),
    reply_markup: markup(buildInlineKeyboard({ buttons })),
    link_preview_options: noPreview,
  });
}

// ---------- update handlers ----------

/** Step 1-2: a user asks to join -> store the pending request and send instructions privately. */
async function handleJoinRequest(ctx, req) {
  const user = req.from;
  if (!user || user.is_bot || !req.chat) return;

  const group = await findGroupByChat(ctx.botId, String(req.chat.id));
  if (!group || group.enabled === false) return;
  const settings = await loadSettings(group.id);
  if (!settings.enabled) return;

  const base = {
    botId: ctx.botId,
    botName: ctx.bot.name,
    groupId: group.id,
    chatId: group.chatId,
    userId: user.id,
    username: user.username,
    firstName: user.first_name,
  };

  const channels = await loadRequiredChannels(ctx.botId, settings.requiredChannelIds);
  if (!channels.length) {
    await writeLog({
      ...base,
      event: 'config_error',
      status: 'failed',
      detail: 'No enabled required channels configured for this group',
    });
    return;
  }

  const now = FieldValue.serverTimestamp();
  await pendingRef(group.id, user.id).set({
    botId: ctx.botId,
    groupId: group.id,
    chatId: group.chatId,
    userId: user.id,
    userChatId: req.user_chat_id || null,
    username: user.username || null,
    firstName: user.first_name || null,
    status: 'pending',
    attempts: 0,
    lastCheckAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await writeLog({ ...base, event: 'join_request', status: 'pending' });

  // Telegram lets the bot message the requester through user_chat_id for a short window,
  // even if they never started the bot. If that fails, the deep-link fallback is used.
  try {
    await sendInstruction(ctx, req.user_chat_id || user.id, { group, settings, channels, user });
    await writeLog({ ...base, event: 'dm_sent', status: 'info' });
  } catch (err) {
    await writeLog({
      ...base,
      event: 'dm_failed',
      status: 'failed',
      detail: `${err.description || err.message}. Fallback: user opens ${startLink(
        ctx.bot.username,
        group.id
      )}`,
    });
  }
}

/** /start (plain) -> private welcome; /start v_<groupId> -> deep-link verification fallback. */
async function handleMessage(ctx, msg) {
  if (!msg.chat || msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) return;
  if (typeof msg.text !== 'string') return;
  const m = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?$/.exec(msg.text.trim());
  if (!m) return;
  const verify = /^v_([A-Za-z0-9]{10,40})$/.exec(m[1] || '');
  if (verify) return startVerification(ctx, msg, verify[1]);
  return sendPrivateWelcome(ctx, msg);
}

async function startVerification(ctx, msg, groupId) {
  const user = msg.from;
  const reply = (text, keyboard) =>
    ctx.client.sendMessage({
      chat_id: msg.chat.id,
      text,
      reply_markup: keyboard,
      link_preview_options: noPreview,
    });

  const group = await getGroup(groupId);
  const settings = group && group.botId === ctx.botId ? await loadSettings(groupId) : null;
  if (!group || !settings || group.enabled === false || !settings.enabled) {
    await reply('This verification link is not valid any more.');
    return;
  }

  const base = {
    botId: ctx.botId,
    botName: ctx.bot.name,
    groupId,
    chatId: group.chatId,
    userId: user.id,
    username: user.username,
    firstName: user.first_name,
  };
  const snap = await pendingRef(groupId, user.id).get();
  const vars = varsFor(ctx, group, user);

  if (snap.exists && snap.data().status === 'approved') {
    await reply(renderTemplate(settings.successText, vars));
    return;
  }
  if (!snap.exists || snap.data().status !== 'pending') {
    const keyboard = group.inviteLink
      ? { inline_keyboard: [[{ text: `Request to join ${group.title || 'the group'}`, url: group.inviteLink }]] }
      : undefined;
    await reply(renderTemplate(settings.noRequestText, vars), keyboard);
    await writeLog({ ...base, event: 'start_command', status: 'info', detail: 'No pending request' });
    return;
  }

  const channels = await loadRequiredChannels(ctx.botId, settings.requiredChannelIds);
  if (!channels.length) {
    await writeLog({ ...base, event: 'config_error', status: 'failed', detail: 'No required channels configured' });
    await reply('Verification is temporarily unavailable. Please try again later.');
    return;
  }
  await writeLog({ ...base, event: 'start_command', status: 'info' });
  await sendInstruction(ctx, msg.chat.id, { group, settings, channels, user });
}

/** Steps 4-7: the user pressed Verify -> check every required channel -> approve or explain. */
async function handleCallback(ctx, cq) {
  const answer = (text, alert = false) =>
    attempt('answerCallbackQuery', () =>
      ctx.client.answerCallbackQuery({
        callback_query_id: cq.id,
        text: text ? text.slice(0, 200) : undefined,
        show_alert: alert,
      })
    );
  const edit = (text, keyboard) =>
    cq.message
      ? attempt('editMessageText', async () => {
          try {
            await ctx.client.editMessageText({
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text,
              reply_markup: keyboard || { inline_keyboard: [] },
              link_preview_options: noPreview,
            });
          } catch (err) {
            if (!isNotModifiedError(err)) throw err;
          }
        })
      : undefined;

  const m = /^v:([A-Za-z0-9]{10,40})$/.exec(cq.data || '');
  if (!m) return answer();

  const user = cq.from;
  const groupId = m[1];
  const group = await getGroup(groupId);
  const settings = group && group.botId === ctx.botId ? await loadSettings(groupId) : null;
  if (!group || !settings || group.enabled === false || !settings.enabled) {
    return answer('This verification is no longer available.', true);
  }

  const base = {
    botId: ctx.botId,
    botName: ctx.bot.name,
    groupId,
    chatId: group.chatId,
    userId: user.id,
    username: user.username,
    firstName: user.first_name,
  };

  const ref = pendingRef(groupId, user.id);
  const snap = await ref.get();
  if (!snap.exists) {
    return answer('No pending join request found. Send a join request to the group first.', true);
  }
  const pending = snap.data();
  if (pending.status === 'approved') return answer('You are already approved ✅', true);
  if (pending.status !== 'pending') {
    return answer('Your join request is no longer pending. Please request to join again.', true);
  }

  const last = pending.lastCheckAt && pending.lastCheckAt.toMillis ? pending.lastCheckAt.toMillis() : 0;
  if (Date.now() - last < settings.cooldownSeconds * 1000) {
    return answer('Please wait a few seconds before trying again.');
  }
  await ref.update({
    lastCheckAt: Timestamp.now(),
    attempts: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeLog({ ...base, event: 'verify_pressed', status: 'info' });

  const channels = await loadRequiredChannels(ctx.botId, settings.requiredChannelIds);
  if (!channels.length) {
    await writeLog({ ...base, event: 'config_error', status: 'failed', detail: 'No required channels configured' });
    return answer('Verification is temporarily unavailable. Please try again later.', true);
  }

  const { missing, errors } = await checkMembership(ctx, channels, user.id);

  // A lookup error is a configuration problem (e.g. bot not admin in the channel).
  // Never approve on error: fail closed.
  if (errors.length) {
    await writeLog({
      ...base,
      event: 'config_error',
      status: 'failed',
      detail: errors.map((e) => `${channelTitle(e.channel)}: ${e.error}`).join('; '),
    });
    return answer('Verification is temporarily unavailable. Please try again later.', true);
  }

  if (missing.length) {
    const names = missing.map(channelTitle);
    await writeLog({
      ...base,
      event: 'verify_failed',
      status: 'failed',
      missingChannelIds: missing.map((c) => c.id),
      detail: `Missing: ${names.join(', ')}`,
    });
    await answer(`You still need to join: ${names.join(', ')}`, true);
    const msg = await buildInstruction(ctx, { group, settings, channels, user, missing });
    await edit(msg.text, msg.reply_markup);
    return undefined;
  }

  // Every requirement satisfied -> approve the pending join request.
  let outcome;
  try {
    outcome = await approveRequest(ctx, group, user);
  } catch (err) {
    await writeLog({ ...base, event: 'approve_failed', status: 'failed', detail: err.description || err.message });
    return answer('We could not approve your request right now. Please contact an admin.', true);
  }

  if (outcome === 'no_request') {
    await ref.update({ status: 'stale', updatedAt: FieldValue.serverTimestamp() });
    await writeLog({ ...base, event: 'approve_failed', status: 'failed', detail: 'Join request is no longer pending' });
    await answer('Your join request is no longer pending. Please request to join again.', true);
    await edit('Your join request is no longer pending. Please send a new join request to the group.');
    return undefined;
  }

  await ref.update({ status: 'approved', approvedAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp() });
  await writeLog({
    ...base,
    event: 'approved',
    status: 'success',
    detail: outcome === 'already_member' ? 'User was already a member' : null,
  });
  await answer('Approved ✅');
  await edit(renderTemplate(settings.successText, varsFor(ctx, group, user)));
  if (outcome === 'approved') await attempt('groupWelcome', () => sendGroupWelcome(ctx, group, user));
  return undefined;
}

async function handleUpdate(ctx, update) {
  if (update.chat_join_request) return handleJoinRequest(ctx, update.chat_join_request);
  if (update.callback_query) return handleCallback(ctx, update.callback_query);
  if (update.message) return handleMessage(ctx, update.message);
  return undefined;
}

module.exports = {
  handleUpdate,
  handleJoinRequest,
  handleCallback,
  handleMessage,
  checkMembership,
  buildInstruction,
};
