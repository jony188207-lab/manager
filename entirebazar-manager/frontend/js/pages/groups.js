import { initPage } from '../shell.js';
import { get, post, patch, del } from '../api.js';
import { botPicker, botStartLink } from '../components.js';
import { h, pageHeader, table, badge, toast, errorBox, errorMessage, confirmDialog, formDialog, copyButton } from '../ui.js';

const { content } = await initPage('groups', 'Group Management');
const body = h('div');
let bot = null;

const picker = await botPicker((b) => { bot = b; load(); });
bot = picker.current();
const addBtn = h('button', { class: 'btn btn-primary', onClick: add }, '+ Add group');
content.append(
  pageHeader('Group Management', addBtn),
  picker.el,
  h('div', { class: 'notice info' }, 'Add the bot to the group as an administrator with the "Invite users" right, and turn on "Approve new members" (join requests) for the group or its invite link. Chat IDs look like -1001234567890.'),
  body
);

async function load() {
  if (!bot) { addBtn.disabled = true; return; }
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    const [{ groups }, { settings }] = await Promise.all([get(`/groups?botId=${bot.id}`), get(`/verification?botId=${bot.id}`)]);
    const rules = Object.fromEntries(settings.map((s) => [s.groupId, s]));
    body.replaceChildren(table({
      empty: 'No groups configured for this bot yet.',
      rows: groups,
      columns: [
        { label: 'Group', render: (g) => h('div', {}, h('strong', {}, g.title), h('div', { class: 'mono muted' }, g.chatId)) },
        { label: 'Status', render: (g) => badge(g.enabled ? 'Enabled' : 'Disabled', g.enabled ? 'success' : 'warn') },
        { label: 'Bot access', render: (g) => {
          const a = g.botAccess;
          if (!a) return badge('Not checked');
          const el = badge(a.ok ? 'OK' : 'Problem', a.ok ? 'success' : 'danger');
          return h('div', {}, el, a.error ? h('small', { class: 'help' }, a.error) : null);
        } },
        { label: 'Verification', render: (g) => {
          const r = rules[g.id];
          if (!r) return badge('Not configured');
          return badge(r.enabled ? `On · ${r.requiredChannelIds.length} channel(s)` : 'Off', r.enabled ? 'success' : 'warn');
        } },
        { label: 'DM fallback link', render: (g) => h('div', { class: 'actions' }, copyButton(botStartLink(bot, g.id), 'Copy link')) },
        { label: 'Actions', render: (g) => h('div', { class: 'actions' },
          h('button', { class: 'btn btn-sm', onClick: () => check(g) }, 'Check access'),
          h('button', { class: 'btn btn-sm', onClick: () => edit(g) }, 'Edit'),
          h('a', { class: 'btn btn-sm', href: 'verification.html' }, 'Rules'),
          h('button', { class: 'btn btn-sm btn-danger', onClick: () => remove(g) }, 'Delete')) },
      ],
    }), h('p', { class: 'help' }, 'The DM fallback link opens the bot with this group\'s verification. Use it when Telegram cannot message a user who never started the bot.'));
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

const fields = (g = {}) => [
  ...(g.id ? [] : [{ name: 'chatId', label: 'Chat ID', required: true, placeholder: '-1001234567890' }]),
  { name: 'title', label: 'Title', value: g.title || '', maxlength: 200, omitEmpty: !g.id, help: 'Leave empty to fetch it from Telegram.' },
  { name: 'inviteLink', label: 'Invite link', value: g.inviteLink || '', placeholder: 'https://t.me/+AbCdEf…', help: 'Shown to users who start the bot without a pending request.' },
  { name: 'enabled', label: 'Enabled', type: 'checkbox', value: g.id ? g.enabled : true },
];

async function add() {
  const saved = await formDialog({
    title: 'Add group', submitLabel: 'Add group', fields: fields(),
    onSubmit: (v) => post('/groups', { ...v, botId: bot.id }),
  });
  if (saved) { toast('Group added. Configure its channels under Verification.', 'success'); load(); }
}

async function edit(g) {
  const saved = await formDialog({ title: 'Edit group', fields: fields(g), onSubmit: (v) => patch(`/groups/${g.id}`, v) });
  if (saved) { toast('Group updated', 'success'); load(); }
}

async function check(g) {
  try {
    const { group } = await post(`/groups/${g.id}/check`);
    toast(group.botAccess.ok ? 'Bot access OK' : `Problem: ${group.botAccess.error}`, group.botAccess.ok ? 'success' : 'error');
    load();
  } catch (err) { toast(errorMessage(err), 'error'); }
}

async function remove(g) {
  const ok = await confirmDialog({
    title: `Delete "${g.title}"?`, danger: true, confirmLabel: 'Delete group',
    message: 'Its verification rules and pending requests are deleted too. Users already approved stay in the Telegram group.',
  });
  if (!ok) return;
  try { await del(`/groups/${g.id}`); toast('Group deleted', 'success'); load(); }
  catch (err) { toast(errorMessage(err), 'error'); }
}

load();
