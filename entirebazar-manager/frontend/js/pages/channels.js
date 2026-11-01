import { initPage } from '../shell.js';
import { get, post, patch, del } from '../api.js';
import { botPicker } from '../components.js';
import { h, pageHeader, table, badge, toast, errorBox, errorMessage, confirmDialog, formDialog } from '../ui.js';

const { content } = await initPage('channels', 'Channel Management');
const body = h('div');
let bot = null;

const picker = await botPicker((b) => { bot = b; load(); });
bot = picker.current();
const addBtn = h('button', { class: 'btn btn-primary', onClick: add }, '+ Add channel');
content.append(
  pageHeader('Channel Management', addBtn),
  picker.el,
  h('div', { class: 'notice info' }, 'Add the bot as an administrator of every required channel, otherwise Telegram will not let it check who has joined. Users need either a public @username or an invite link to join.'),
  body
);

async function load() {
  if (!bot) { addBtn.disabled = true; return; }
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    const { channels } = await get(`/channels?botId=${bot.id}`);
    body.replaceChildren(table({
      empty: 'No channels configured for this bot yet.',
      rows: channels,
      columns: [
        { label: 'Channel', render: (c) => h('div', {}, h('strong', {}, c.title), h('div', { class: 'mono muted' }, c.chatId)) },
        { label: 'Join link', render: (c) => {
          const url = c.inviteLink || (c.username ? `https://t.me/${c.username}` : (String(c.chatId).startsWith('@') ? `https://t.me/${c.chatId.slice(1)}` : null));
          return url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url) : '—';
        } },
        { label: 'Status', render: (c) => badge(c.enabled ? 'Enabled' : 'Disabled', c.enabled ? 'success' : 'warn') },
        { label: 'Bot access', render: (c) => {
          const a = c.botAccess;
          if (!a) return badge('Not checked');
          return h('div', {}, badge(a.ok ? 'OK' : 'Problem', a.ok ? 'success' : 'danger'), a.error ? h('small', { class: 'help' }, a.error) : null);
        } },
        { label: 'Actions', render: (c) => h('div', { class: 'actions' },
          h('button', { class: 'btn btn-sm', onClick: () => check(c) }, 'Check access'),
          h('button', { class: 'btn btn-sm', onClick: () => edit(c) }, 'Edit'),
          h('button', { class: 'btn btn-sm btn-danger', onClick: () => remove(c) }, 'Delete')) },
      ],
    }));
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

const fields = (c = {}) => [
  ...(c.id ? [] : [{ name: 'chatId', label: 'Chat ID or @username', required: true, placeholder: '-1001234567890 or @mychannel' }]),
  { name: 'title', label: 'Title', value: c.title || '', maxlength: 200, omitEmpty: !c.id, help: 'Leave empty to fetch it from Telegram.' },
  { name: 'username', label: 'Public username', value: c.username ? `@${c.username}` : '', placeholder: '@mychannel', help: 'For public channels.' },
  { name: 'inviteLink', label: 'Invite link', value: c.inviteLink || '', placeholder: 'https://t.me/+AbCdEf…', help: 'For private channels.' },
  { name: 'enabled', label: 'Enabled', type: 'checkbox', value: c.id ? c.enabled : true },
];

async function add() {
  const saved = await formDialog({
    title: 'Add channel', submitLabel: 'Add channel', fields: fields(),
    onSubmit: (v) => post('/channels', { ...v, botId: bot.id }),
  });
  if (saved) { toast('Channel added', 'success'); load(); }
}

async function edit(c) {
  const saved = await formDialog({ title: 'Edit channel', fields: fields(c), onSubmit: (v) => patch(`/channels/${c.id}`, v) });
  if (saved) { toast('Channel updated', 'success'); load(); }
}

async function check(c) {
  try {
    const { channel } = await post(`/channels/${c.id}/check`);
    toast(channel.botAccess.ok ? 'Bot access OK' : `Problem: ${channel.botAccess.error}`, channel.botAccess.ok ? 'success' : 'error');
    load();
  } catch (err) { toast(errorMessage(err), 'error'); }
}

async function remove(c) {
  const ok = await confirmDialog({
    title: `Delete "${c.title}"?`, danger: true, confirmLabel: 'Delete channel',
    message: 'It is also removed from every group\'s required channels. Groups left with no required channel have verification switched off.',
  });
  if (!ok) return;
  try { await del(`/channels/${c.id}`); toast('Channel deleted', 'success'); load(); }
  catch (err) { toast(errorMessage(err), 'error'); }
}

load();
