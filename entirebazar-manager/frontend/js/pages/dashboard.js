import { initPage } from '../shell.js';
import { get } from '../api.js';
import { h, pageHeader, table, badge, fmtDate, errorBox } from '../ui.js';

export const EVENT_BADGE = {
  approved: 'success', verify_failed: 'warn', dm_failed: 'danger', approve_failed: 'danger',
  config_error: 'danger', join_request: 'info', dm_sent: '', verify_pressed: '', start_command: '',
};

const { content } = await initPage('dashboard', 'Dashboard');
content.append(pageHeader('Dashboard'));
const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
content.append(body);

try {
  const d = await get('/dashboard');
  const stat = (num, label) => h('div', { class: 'card stat' }, h('div', { class: 'num' }, num), h('div', { class: 'label' }, label));
  body.replaceChildren(
    h('div', { class: 'cards' },
      stat(`${d.counts.botsEnabled}/${d.counts.bots}`, 'Bots enabled'),
      stat(d.counts.groups, 'Groups'),
      stat(d.counts.channels, 'Channels'),
      stat(d.counts.pending, 'Pending requests'),
      stat(d.last24h.joinRequests, 'Join requests (24h)'),
      stat(d.last24h.approved, 'Approved (24h)'),
      stat(d.last24h.failed, 'Failed checks (24h)')
    ),
    h('h2', {}, 'Recent activity'),
    table({
      empty: 'No verification activity yet.',
      rows: d.recentLogs,
      columns: [
        { label: 'Time', render: (r) => fmtDate(r.createdAt) },
        { label: 'Bot', render: (r) => r.botName || '—' },
        { label: 'Event', render: (r) => badge(r.event, EVENT_BADGE[r.event]) },
        { label: 'User', render: (r) => r.username ? `@${r.username}` : r.firstName || r.userId || '—' },
        { label: 'Detail', render: (r) => r.detail || '' },
      ],
    })
  );
} catch (err) {
  body.replaceChildren(errorBox(err));
}
