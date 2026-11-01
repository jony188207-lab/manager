import { initPage } from '../shell.js';
import { get, post, put, patch, del } from '../api.js';
import { h, pageHeader, table, badge, fmtDate, toast, errorBox, errorMessage, confirmDialog, formDialog, copyButton } from '../ui.js';

const { content } = await initPage('bots', 'Bot Management');
const body = h('div');
content.append(
  pageHeader('Bot Management', h('button', { class: 'btn btn-primary', onClick: addBot }, '+ Add bot')),
  h('div', { class: 'notice info' }, 'Bot tokens are encrypted and stored only on the backend. They are never shown again after saving.'),
  body
);

const WEBHOOK = { active: ['Webhook active', 'success'], inactive: ['Webhook off', ''], error: ['Webhook error', 'danger'] };

async function load() {
  try {
    const { bots } = await get('/bots');
    body.replaceChildren(table({
      empty: 'No bots yet. Add your first bot with a token from @BotFather.',
      rows: bots,
      columns: [
        { label: 'Name', render: (b) => b.name },
        { label: 'Username', render: (b) => h('a', { href: `https://t.me/${b.username}`, target: '_blank', rel: 'noopener noreferrer' }, `@${b.username}`) },
        { label: 'Status', render: (b) => badge(b.enabled ? 'Enabled' : 'Disabled', b.enabled ? 'success' : 'warn') },
        { label: 'Webhook', render: (b) => {
          const [text, kind] = WEBHOOK[b.webhookStatus] || WEBHOOK.inactive;
          const el = badge(text, kind);
          if (b.webhookError) el.title = b.webhookError;
          return h('div', {}, el, b.webhookError ? h('small', { class: 'help' }, b.webhookError) : null);
        } },
        { label: 'Added', render: (b) => fmtDate(b.createdAt) },
        { label: 'Actions', render: (b) => h('div', { class: 'actions' },
          h('button', { class: 'btn btn-sm', onClick: () => toggle(b) }, b.enabled ? 'Disable' : 'Enable'),
          h('button', { class: 'btn btn-sm', onClick: () => rename(b) }, 'Rename'),
          h('button', { class: 'btn btn-sm', onClick: () => rotate(b) }, 'Replace token'),
          h('button', { class: 'btn btn-sm', onClick: () => resync(b) }, 'Re-sync webhook'),
          h('button', { class: 'btn btn-sm', onClick: () => info(b) }, 'Webhook info'),
          h('button', { class: 'btn btn-sm btn-danger', onClick: () => remove(b) }, 'Delete')) },
      ],
    }));
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

async function run(fn, okMessage) {
  try {
    await fn();
    if (okMessage) toast(okMessage, 'success');
    await load();
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

async function addBot() {
  const saved = await formDialog({
    title: 'Add bot',
    description: 'Create the bot with @BotFather, then paste its token. It is verified with Telegram, encrypted, and never shown again.',
    submitLabel: 'Add bot',
    fields: [
      { name: 'name', label: 'Display name', required: true, maxlength: 60, placeholder: 'e.g. Main verification bot' },
      { name: 'token', label: 'Bot token', type: 'password', required: true },
      { name: 'enabled', label: 'Enable immediately (registers the webhook)', type: 'checkbox', value: true },
    ],
    onSubmit: (v) => post('/bots', v),
  });
  if (saved) { toast('Bot added', 'success'); load(); }
}

const toggle = (b) => run(() => patch(`/bots/${b.id}`, { enabled: !b.enabled }), b.enabled ? 'Bot disabled' : 'Bot enabled');
const resync = (b) => run(() => post(`/bots/${b.id}/webhook`), 'Webhook re-synced');

async function rename(b) {
  const saved = await formDialog({
    title: 'Rename bot', fields: [{ name: 'name', label: 'Display name', value: b.name, required: true, maxlength: 60 }],
    onSubmit: (v) => patch(`/bots/${b.id}`, v),
  });
  if (saved) { toast('Bot renamed', 'success'); load(); }
}

async function rotate(b) {
  const saved = await formDialog({
    title: `Replace token for @${b.username}`,
    description: 'Use this after revoking the token in @BotFather. The new token must belong to the same bot.',
    fields: [{ name: 'token', label: 'New bot token', type: 'password', required: true }],
    onSubmit: (v) => put(`/bots/${b.id}/token`, v),
  });
  if (saved) { toast('Token replaced', 'success'); load(); }
}

async function info(b) {
  try {
    const w = await get(`/bots/${b.id}/webhook-info`);
    await formDialog({
      title: `Webhook info: @${b.username}`, submitLabel: 'Close',
      fields: [
        { name: 'url', label: 'URL', value: w.url || '(not set)' },
        { name: 'pending', label: 'Pending updates', value: String(w.pendingUpdateCount) },
        { name: 'err', label: 'Last error', value: w.lastErrorMessage ? `${w.lastErrorMessage} (${fmtDate(w.lastErrorDate)})` : 'None' },
      ],
      onSubmit: async () => {},
    });
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

async function remove(b) {
  const ok = await confirmDialog({
    title: `Delete @${b.username}?`, danger: true, confirmLabel: 'Delete bot',
    message: 'This removes the bot, its token, groups, channels, rules, buttons and welcome messages from the panel and deletes its Telegram webhook. Logs are kept. This cannot be undone.',
  });
  if (ok) run(() => del(`/bots/${b.id}`), 'Bot deleted');
}

load();
