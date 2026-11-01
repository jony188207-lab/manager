import { initPage } from '../shell.js';
import { get, post, put, patch, del, qs } from '../api.js';
import { botPicker, keyboardPreview } from '../components.js';
import { h, pageHeader, toast, errorBox, errorMessage, confirmDialog, formDialog, badge, emptyState } from '../ui.js';

const { content } = await initPage('buttons', 'Inline Button Manager');
const body = h('div');
let bot = null;
let placement = 'welcome';

const PLACEMENTS = {
  welcome: 'Welcome messages',
  verification: 'Verification message',
};
const SAMPLE_TEXT = {
  welcome: 'Welcome to the group, @username!',
  verification: 'Hi Ana! To join the group, please join the channels below, then tap Verify.',
};

const picker = await botPicker((b) => { bot = b; load(); });
bot = picker.current();
const tabs = h('div', { class: 'tabs' });
const addBtn = h('button', { class: 'btn btn-primary', onClick: add }, '+ Add button');
content.append(
  pageHeader('Inline Button Manager', addBtn),
  picker.el,
  h('div', { class: 'notice info' }, 'Buttons are URL buttons. Welcome buttons appear under both the group welcome and the private /start message. Verification buttons appear in the private verification message; channel buttons and the Verify button are added automatically.'),
  tabs,
  body
);

function renderTabs() {
  tabs.replaceChildren(...Object.entries(PLACEMENTS).map(([key, label]) =>
    h('button', { class: `tab ${key === placement ? 'active' : ''}`, type: 'button', onClick: () => { placement = key; renderTabs(); load(); } }, label)));
}

// Group stored buttons into rows (sorted by row, then position).
function toRows(buttons) {
  const rows = [];
  let current = null;
  for (const b of buttons) {
    if (b.row !== current) { rows.push([]); current = b.row; }
    rows[rows.length - 1].push(b);
  }
  return rows;
}

async function saveLayout(rows) {
  const items = rows.flatMap((r, ri) => r.map((b, pi) => ({ id: b.id, row: ri, position: pi })));
  if (!items.length) return;
  try {
    await put('/buttons/layout', { botId: bot.id, placement, items });
    await load();
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

function move(rows, ri, pi, dir) {
  const next = rows.map((r) => [...r]);
  const [btn] = next[ri].splice(pi, 1);
  if (dir === 'left' || dir === 'right') {
    const to = dir === 'left' ? pi - 1 : pi + 1;
    if (to < 0 || to > next[ri].length) return null;
    next[ri].splice(to, 0, btn);
  } else if (dir === 'up') {
    if (ri === 0) {
      if (!next[0].length) return null;           // alone in first row: nothing to do
      next.unshift([btn]);
    } else next[ri - 1].push(btn);
  } else if (dir === 'down') {
    if (ri === next.length - 1) {
      if (!next[ri].length) return null;          // alone in last row: nothing to do
      next.push([btn]);
    } else next[ri + 1].push(btn);
  }
  const cleaned = next.filter((r) => r.length);
  return cleaned.some((r) => r.length > 8) ? 'full' : cleaned;
}

async function load() {
  renderTabs();
  if (!bot) { addBtn.disabled = true; return; }
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    const [{ buttons }, preview] = await Promise.all([
      get(`/buttons${qs({ botId: bot.id, placement })}`),
      get(`/buttons/preview${qs({ botId: bot.id, placement })}`),
    ]);
    const rows = toRows(buttons);

    const layout = rows.length ? rows.map((row, ri) => h('div', { class: 'btn-row' },
      h('div', { class: 'row-label' }, `Row ${ri + 1}`),
      row.map((b, pi) => h('div', { class: `btn-chip ${b.enabled ? '' : 'off'}` },
        h('div', {}, h('div', { class: 'label' }, b.label), h('div', { class: 'url' }, b.url), b.enabled ? null : badge('Disabled', 'warn')),
        h('div', { class: 'actions' },
          arrow(rows, ri, pi, 'left', '◀', 'Move left'),
          arrow(rows, ri, pi, 'right', '▶', 'Move right'),
          arrow(rows, ri, pi, 'up', '▲', 'Move to previous row'),
          arrow(rows, ri, pi, 'down', '▼', 'Move to next row'),
          h('button', { class: 'btn btn-sm', onClick: () => toggle(b) }, b.enabled ? 'Disable' : 'Enable'),
          h('button', { class: 'btn btn-sm', onClick: () => edit(b) }, 'Edit'),
          h('button', { class: 'btn btn-sm btn-danger', onClick: () => remove(b) }, 'Delete'))))
    )) : [emptyState('No buttons yet for this message.')];

    const sampleBefore = placement === 'verification' ? [[{ text: '📢 Channel name' }]] : [];
    const sampleAfter = placement === 'verification' ? [[{ text: '✅ Verify' }]] : [];
    body.replaceChildren(h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('h2', {}, `Layout: ${PLACEMENTS[placement]}`), layout),
      h('div', { class: 'card' }, h('h2', {}, 'Telegram preview'),
        keyboardPreview({ text: SAMPLE_TEXT[placement], rows: preview.inline_keyboard, sampleBefore, sampleAfter }),
        h('p', { class: 'help' }, 'Only enabled buttons are sent. Greyed items are added by the bot automatically.'))
    ));
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

function arrow(rows, ri, pi, dir, symbol, title) {
  return h('button', {
    class: 'btn btn-sm', title, 'aria-label': title,
    onClick: () => {
      const next = move(rows, ri, pi, dir);
      if (next === 'full') return toast('A row can hold at most 8 buttons', 'error');
      if (next) saveLayout(next);
      return undefined;
    },
  }, symbol);
}

const fields = (b = {}) => [
  { name: 'label', label: 'Label', value: b.label || '', required: true, maxlength: 64 },
  { name: 'url', label: 'URL', type: 'url', value: b.url || '', required: true, placeholder: 'https://example.com', help: 'https://, http:// or tg:// links.' },
  { name: 'enabled', label: 'Enabled', type: 'checkbox', value: b.id ? b.enabled : true },
];

async function add() {
  const saved = await formDialog({
    title: `Add button (${PLACEMENTS[placement]})`, fields: fields(),
    description: 'The button is added at the end of the last row (or a new row if it is full). Use the arrows to rearrange.',
    onSubmit: (v) => post('/buttons', { ...v, botId: bot.id, placement }),
  });
  if (saved) { toast('Button added', 'success'); load(); }
}

async function edit(b) {
  const saved = await formDialog({ title: 'Edit button', fields: fields(b), onSubmit: (v) => patch(`/buttons/${b.id}`, v) });
  if (saved) { toast('Button updated', 'success'); load(); }
}

async function toggle(b) {
  try { await patch(`/buttons/${b.id}`, { enabled: !b.enabled }); load(); }
  catch (err) { toast(errorMessage(err), 'error'); }
}

async function remove(b) {
  const ok = await confirmDialog({ title: `Delete "${b.label}"?`, danger: true, confirmLabel: 'Delete button', message: 'This cannot be undone.' });
  if (!ok) return;
  try { await del(`/buttons/${b.id}`); toast('Button deleted', 'success'); load(); }
  catch (err) { toast(errorMessage(err), 'error'); }
}

load();
