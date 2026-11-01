'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeDb, Timestamp, FieldValue } = require('./helpers/fakeFirestore');

const db = new FakeDb();
function stub(rel, exports) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports, children: [], paths: [] };
}
stub('../src/config/firebase', { db, FieldValue, Timestamp });
stub('../src/utils/logger', { info() {}, warn() {}, error() {}, debug() {} });
const svc = require('../src/services/verificationService');

const BOT = 'botAAAAAAAAAA1';
const GROUP = 'grpAAAAAAAAAA1';
const CH1 = 'chnAAAAAAAAAA1';
const CH2 = 'chnBBBBBBBBBB2';
const GROUP_CHAT = '-1001000000001';
const CH1_CHAT = '-1001000000002';
const CH2_CHAT = '-1001000000003';
const USER = { id: 42, first_name: 'Ana', username: 'ana' };

function seed(settingsOverride = {}) {
  db.reset();
  db.seed('bots', BOT, { name: 'Bazar Bot', username: 'bazar_bot', telegramBotId: 111, enabled: true });
  db.seed('groups', GROUP, { botId: BOT, chatId: GROUP_CHAT, title: 'Bazar Group', enabled: true, inviteLink: 'https://t.me/+abc' });
  db.seed('channels', CH1, { botId: BOT, chatId: CH1_CHAT, title: 'News', inviteLink: 'https://t.me/+news', enabled: true });
  db.seed('channels', CH2, { botId: BOT, chatId: CH2_CHAT, title: 'Deals', username: 'deals_chan', enabled: true });
  db.seed('verificationSettings', GROUP, {
    botId: BOT, groupId: GROUP, enabled: true, requiredChannelIds: [CH1, CH2], ...settingsOverride,
  });
  db.seed('buttons', 'btnAAAAAAAAAA1', { botId: BOT, placement: 'verification', label: 'Rules', url: 'https://example.com/rules', row: 0, position: 0, enabled: true });
  db.seed('buttons', 'btnBBBBBBBBBB2', { botId: BOT, placement: 'verification', label: 'Hidden', url: 'https://example.com/x', row: 1, position: 0, enabled: false });
}

function makeCtx({ membership = {}, failSend = false, approveError = null, memberError = false } = {}) {
  const calls = [];
  const rec = (name, impl) => async (p) => {
    calls.push({ name, p });
    return impl ? impl(p) : true;
  };
  const client = {
    calls,
    getChatMember: rec('getChatMember', (p) => {
      if (memberError) throw Object.assign(new Error('x'), { description: 'Bad Request: chat not found' });
      return { status: membership[`${p.chat_id}:${p.user_id}`] || 'left' };
    }),
    sendMessage: rec('sendMessage', () => {
      if (failSend) throw Object.assign(new Error('x'), { description: 'Forbidden: bot was blocked by the user' });
      return true;
    }),
    editMessageText: rec('editMessageText'),
    answerCallbackQuery: rec('answerCallbackQuery'),
    approveChatJoinRequest: rec('approveChatJoinRequest', () => {
      if (approveError) throw Object.assign(new Error('x'), { description: approveError });
      return true;
    }),
  };
  return { botId: BOT, bot: { id: BOT, ...db.read('bots', BOT) }, client };
}

const joinUpdate = () => ({
  chat_join_request: { chat: { id: Number(GROUP_CHAT), title: 'Bazar Group' }, from: USER, user_chat_id: 42, date: 1 },
});
const verifyUpdate = () => ({
  callback_query: { id: 'cq1', from: USER, data: `v:${GROUP}`, message: { chat: { id: 42 }, message_id: 7 } },
});
const pendingKey = `${GROUP}_${USER.id}`;
const events = () => db.list('verificationLogs').map((l) => l.event);
const resetCooldown = () => db.patch('pendingRequests', pendingKey, { lastCheckAt: null });
const sent = (ctx, name) => ctx.client.calls.filter((c) => c.name === name);

test('join request creates a pending record and DMs instructions with channel buttons + Verify', async () => {
  seed();
  const ctx = makeCtx();
  await svc.handleUpdate(ctx, joinUpdate());

  assert.equal(db.read('pendingRequests', pendingKey).status, 'pending');
  const [dm] = sent(ctx, 'sendMessage');
  assert.equal(dm.p.chat_id, 42);
  const rows = dm.p.reply_markup.inline_keyboard;
  assert.equal(rows[0][0].url, 'https://t.me/+news');
  assert.equal(rows[1][0].url, 'https://t.me/deals_chan');
  assert.equal(rows[2][0].text, 'Rules'); // enabled custom button; disabled one is skipped
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[3][0].callback_data, `v:${GROUP}`);
  assert.deepEqual(events(), ['join_request', 'dm_sent']);
});

test('join request is ignored when verification is disabled for the group', async () => {
  seed({ enabled: false });
  const ctx = makeCtx();
  await svc.handleUpdate(ctx, joinUpdate());
  assert.equal(ctx.client.calls.length, 0);
  assert.equal(db.list('pendingRequests').length, 0);
});

test('failed DM is logged with the deep-link fallback and does not throw', async () => {
  seed();
  const ctx = makeCtx({ failSend: true });
  await svc.handleUpdate(ctx, joinUpdate());
  const log = db.list('verificationLogs').find((l) => l.event === 'dm_failed');
  assert.ok(log.detail.includes(`https://t.me/bazar_bot?start=v_${GROUP}`));
  assert.equal(db.read('pendingRequests', pendingKey).status, 'pending');
});

test('verify with a missing channel keeps the request pending and explains why', async () => {
  seed();
  const ctx = makeCtx({ membership: { [`${CH1_CHAT}:42`]: 'member' } });
  await svc.handleUpdate(ctx, joinUpdate());
  await svc.handleUpdate(ctx, verifyUpdate());

  assert.equal(sent(ctx, 'approveChatJoinRequest').length, 0);
  assert.equal(db.read('pendingRequests', pendingKey).status, 'pending');
  const edit = sent(ctx, 'editMessageText')[0];
  assert.match(edit.p.text, /Deals/);
  assert.doesNotMatch(edit.p.text, /News/);
  const failed = db.list('verificationLogs').find((l) => l.event === 'verify_failed');
  assert.deepEqual(failed.missingChannelIds, [CH2]);
});

test('verify with every channel joined approves the join request', async () => {
  seed();
  const ctx = makeCtx({ membership: { [`${CH1_CHAT}:42`]: 'member', [`${CH2_CHAT}:42`]: 'administrator' } });
  await svc.handleUpdate(ctx, joinUpdate());
  await svc.handleUpdate(ctx, verifyUpdate());

  const [approve] = sent(ctx, 'approveChatJoinRequest');
  assert.deepEqual(approve.p, { chat_id: GROUP_CHAT, user_id: 42 });
  assert.equal(db.read('pendingRequests', pendingKey).status, 'approved');
  assert.ok(events().includes('approved'));
  assert.match(sent(ctx, 'editMessageText')[0].p.text, /approved/i);
});

test('group welcome is only posted after approval and only when enabled', async () => {
  seed();
  db.seed('welcomeMessages', BOT, { groupWelcome: { enabled: true, text: 'Hello {username} in {group_title}' } });
  const ctx = makeCtx({ membership: { [`${CH1_CHAT}:42`]: 'member', [`${CH2_CHAT}:42`]: 'member' } });
  await svc.handleUpdate(ctx, joinUpdate());
  await svc.handleUpdate(ctx, verifyUpdate());
  const groupMsg = sent(ctx, 'sendMessage').find((c) => c.p.chat_id === GROUP_CHAT);
  assert.equal(groupMsg.p.text, 'Hello @ana in Bazar Group');
});

test('cooldown blocks rapid repeated Verify presses', async () => {
  seed();
  const ctx = makeCtx();
  await svc.handleUpdate(ctx, joinUpdate());
  await svc.handleUpdate(ctx, verifyUpdate());
  const lookups = sent(ctx, 'getChatMember').length;
  await svc.handleUpdate(ctx, verifyUpdate());
  assert.equal(sent(ctx, 'getChatMember').length, lookups);
});

test('left/kicked statuses count as not joined; restricted needs is_member', async () => {
  seed();
  const ctx = makeCtx({ membership: { [`${CH1_CHAT}:42`]: 'kicked', [`${CH2_CHAT}:42`]: 'member' } });
  const { missing } = await svc.checkMembership(ctx, [
    { id: CH1, chatId: CH1_CHAT, title: 'News' },
    { id: CH2, chatId: CH2_CHAT, title: 'Deals' },
  ], 42);
  assert.deepEqual(missing.map((c) => c.id), [CH1]);
});

test('lookup errors fail closed: never approve and log a config error', async () => {
  seed();
  const ctx = makeCtx({ memberError: true });
  await svc.handleUpdate(ctx, joinUpdate());
  await svc.handleUpdate(ctx, verifyUpdate());
  assert.equal(sent(ctx, 'approveChatJoinRequest').length, 0);
  assert.ok(events().includes('config_error'));
  assert.equal(db.read('pendingRequests', pendingKey).status, 'pending');
});

test('stale join request (HIDE_REQUESTER_MISSING) is marked stale', async () => {
  seed();
  const ctx = makeCtx({
    membership: { [`${CH1_CHAT}:42`]: 'member', [`${CH2_CHAT}:42`]: 'member' },
    approveError: 'Bad Request: HIDE_REQUESTER_MISSING',
  });
  await svc.handleUpdate(ctx, joinUpdate());
  await svc.handleUpdate(ctx, verifyUpdate());
  assert.equal(db.read('pendingRequests', pendingKey).status, 'stale');
});

test('a user without a pending request cannot get approved', async () => {
  seed();
  const ctx = makeCtx({ membership: { [`${CH1_CHAT}:42`]: 'member', [`${CH2_CHAT}:42`]: 'member' } });
  await svc.handleUpdate(ctx, verifyUpdate());
  assert.equal(sent(ctx, 'approveChatJoinRequest').length, 0);
});

test('/start v_<groupId> re-sends instructions when a request is pending', async () => {
  seed();
  const ctx = makeCtx();
  await svc.handleUpdate(ctx, joinUpdate());
  ctx.client.calls.length = 0;
  await svc.handleUpdate(ctx, { message: { chat: { id: 42, type: 'private' }, from: USER, text: `/start v_${GROUP}` } });
  const [dm] = sent(ctx, 'sendMessage');
  assert.equal(dm.p.reply_markup.inline_keyboard.at(-1)[0].callback_data, `v:${GROUP}`);
});

test('/start v_<groupId> without a pending request points to the group invite link', async () => {
  seed();
  const ctx = makeCtx();
  await svc.handleUpdate(ctx, { message: { chat: { id: 42, type: 'private' }, from: USER, text: `/start v_${GROUP}` } });
  const [dm] = sent(ctx, 'sendMessage');
  assert.equal(dm.p.reply_markup.inline_keyboard[0][0].url, 'https://t.me/+abc');
});

test('plain /start sends the private welcome; group chats are ignored', async () => {
  seed();
  const ctx = makeCtx();
  await svc.handleUpdate(ctx, { message: { chat: { id: 42, type: 'private' }, from: USER, text: '/start' } });
  assert.equal(sent(ctx, 'sendMessage').length, 1);
  assert.match(sent(ctx, 'sendMessage')[0].p.text, /Ana/);
  await svc.handleUpdate(ctx, { message: { chat: { id: -5, type: 'supergroup' }, from: USER, text: '/start' } });
  assert.equal(sent(ctx, 'sendMessage').length, 1);
});
