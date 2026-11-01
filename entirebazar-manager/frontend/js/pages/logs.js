import { initPage } from '../shell.js';
import { get, post, qs } from '../api.js';
import { h, pageHeader, table, badge, fmtDate, toast, errorBox, errorMessage, confirmDialog, createFields } from '../ui.js';

const EVENT_BADGE = {
  approved: 'success', verify_failed: 'warn', dm_failed: 'danger', approve_failed: 'danger',
  config_error: 'danger', join_request: 'info',
};
const EVENTS = ['join_request', 'dm_sent', 'dm_failed', 'start_command', 'verify_pressed', 'verify_failed', 'approved', 'approve_failed', 'config_error'];

const { me, content } = await initPage('logs', 'User Verification Logs');
const { bots } = await get('/bots');

const filters = createFields([
  { name: 'botId', label: 'Bot', type: 'select', value: '', options: [{ value: '', label: 'All bots' }, ...bots.map((b) => ({ value: b.id, label: b.name }))] },
  { name: 'event', label: 'Event', type: 'select', value: '', options: [{ value: '', label: 'All events' }, ...EVENTS.map((e) => ({ value: e, label: e }))] },
  { name: 'userId', label: 'Telegram user ID', value: '', placeholder: 'numeric id' },
]);
const applyBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => reload() }, 'Apply filters');
const more = h('button', { class: 'btn hidden', type: 'button', onClick: () => fetchPage() }, 'Load more');
const body = h('div');
let rows = [];
let cursor = null;

content.append(
  pageHeader('User Verification Logs',
    me.role === 'super_admin' ? h('button', { class: 'btn btn-danger', onClick: purge }, 'Purge old logs') : null),
  h('div', { class: 'card' }, filters.el, h('div', { class: 'actions' }, applyBtn)),
  body,
  h('div', { class: 'actions' }, more)
);

function render() {
  body.replaceChildren(table({
    empty: 'No log entries match.',
    rows,
    columns: [
      { label: 'Time', render: (r) => fmtDate(r.createdAt) },
      { label: 'Bot', render: (r) => r.botName || '—' },
      { label: 'Event', render: (r) => badge(r.event, EVENT_BADGE[r.event]) },
      { label: 'User', render: (r) => h('div', {}, r.username ? `@${r.username}` : r.firstName || '—', h('div', { class: 'mono muted' }, r.userId || '')) },
      { label: 'Detail', render: (r) => r.detail || '' },
    ],
  }));
  more.classList.toggle('hidden', !cursor);
}

async function fetchPage() {
  try {
    const v = filters.read();
    const data = await get(`/logs${qs({ botId: v.botId, event: v.event, userId: v.userId, cursor, limit: 50 })}`);
    rows = rows.concat(data.logs);
    cursor = data.nextCursor;
    render();
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

function reload() {
  rows = [];
  cursor = null;
  fetchPage();
}

async function purge() {
  const ok = await confirmDialog({
    title: 'Purge old logs?', danger: true, confirmLabel: 'Purge',
    message: 'Deletes log entries older than the retention period set in General Settings. This cannot be undone.',
  });
  if (!ok) return;
  try {
    const r = await post('/logs/purge');
    toast(`Deleted ${r.deleted} entries older than ${r.retentionDays} days`, 'success');
    reload();
  } catch (err) { toast(errorMessage(err), 'error'); }
}

reload();
