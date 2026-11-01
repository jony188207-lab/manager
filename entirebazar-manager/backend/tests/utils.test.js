'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createCrypto, safeEqual } = require('../src/utils/crypto');
const { buildButtonRows, buildInlineKeyboard, renderTemplate } = require('../src/utils/keyboard');
const { isMemberStatus, channelJoinUrl } = require('../src/utils/telegramHelpers');
const { scrubSecrets } = require('../src/utils/redact');

const key = crypto.randomBytes(32).toString('base64');

test('crypto: round trip, AAD binding and tamper detection', () => {
  const c = createCrypto(key);
  const enc = c.encrypt('123456:ABCDEF', 'bot1');
  assert.equal(c.decrypt(enc, 'bot1'), '123456:ABCDEF');
  assert.throws(() => c.decrypt(enc, 'bot2'));
  assert.throws(() => c.decrypt({ ...enc, data: Buffer.from('tampered').toString('base64') }, 'bot1'));
  assert.ok(!JSON.stringify(enc).includes('ABCDEF'));
});

test('crypto: rejects bad keys, derives stable per-bot webhook secrets', () => {
  assert.throws(() => createCrypto('short'));
  const c = createCrypto(key);
  assert.equal(c.webhookSecret('a'), c.webhookSecret('a'));
  assert.notEqual(c.webhookSecret('a'), c.webhookSecret('b'));
  assert.match(c.webhookSecret('a'), /^[0-9a-f]{64}$/);
  assert.equal(safeEqual('x', 'x'), true);
  assert.equal(safeEqual('x', 'xy'), false);
});

test('keyboard: orders rows/positions, skips disabled, caps row size', () => {
  const rows = buildButtonRows([
    { id: 'c', label: 'C', url: 'https://c.example', row: 1, position: 0 },
    { id: 'b', label: 'B', url: 'https://b.example', row: 0, position: 1 },
    { id: 'a', label: 'A', url: 'https://a.example', row: 0, position: 0 },
    { id: 'd', label: 'D', url: 'https://d.example', row: 2, position: 0, enabled: false },
  ]);
  assert.deepEqual(rows.map((r) => r.map((b) => b.text)), [['A', 'B'], ['C']]);

  const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, label: `L${i}`, url: 'https://e.example', row: 0, position: i }));
  assert.equal(buildButtonRows(many)[0].length, 8);
  assert.deepEqual(buildInlineKeyboard({ buttons: [] }).inline_keyboard, []);
});

test('template: replaces known placeholders only', () => {
  assert.equal(renderTemplate('Hi {first_name} {unknown}', { first_name: 'Ana' }), 'Hi Ana {unknown}');
});

test('membership statuses', () => {
  assert.equal(isMemberStatus({ status: 'member' }), true);
  assert.equal(isMemberStatus({ status: 'creator' }), true);
  assert.equal(isMemberStatus({ status: 'left' }), false);
  assert.equal(isMemberStatus({ status: 'kicked' }), false);
  assert.equal(isMemberStatus({ status: 'restricted', is_member: true }), true);
  assert.equal(isMemberStatus({ status: 'restricted', is_member: false }), false);
  assert.equal(channelJoinUrl({ username: 'abc_def' }), 'https://t.me/abc_def');
  assert.equal(channelJoinUrl({ chatId: '-100123' }), null);
});

test('redaction removes bot tokens and bearer tokens', () => {
  const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_x';
  assert.equal(scrubSecrets(`failed for ${token}`), 'failed for [REDACTED_BOT_TOKEN]');
  assert.equal(scrubSecrets('Bearer abc.def.ghi'), 'Bearer [REDACTED]');
});

let hasZod = true;
try { require.resolve('zod'); } catch (_) { hasZod = false; }

test('validators: input rules', { skip: !hasZod && 'zod not installed' }, () => {
  const v = require('../src/utils/validators');
  assert.ok(v.botCreate.safeParse({ name: 'A', token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_x' }).success);
  assert.ok(!v.botCreate.safeParse({ name: 'A', token: 'nope' }).success);
  assert.ok(!v.botCreate.safeParse({ name: 'A', token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_x', role: 'super_admin' }).success);
  assert.ok(v.groupCreate.safeParse({ botId: 'botAAAAAAAAAA1', chatId: -1001234567890 }).success);
  assert.ok(!v.buttonCreate.safeParse({ botId: 'botAAAAAAAAAA1', placement: 'welcome', label: 'x', url: 'javascript:alert(1)' }).success);
  assert.ok(!v.channelCreate.safeParse({ botId: 'botAAAAAAAAAA1', chatId: '-1001234567890' }).success);
  assert.ok(v.channelCreate.safeParse({ botId: 'botAAAAAAAAAA1', chatId: '@my_channel' }).success);
  assert.ok(!v.verificationUpdate.safeParse({ enabled: true, requiredChannelIds: [], verifyButtonText: 'V', instructionText: 'a', successText: 'a', missingText: 'a', noRequestText: 'a', cooldownSeconds: 5 }).success);
});
