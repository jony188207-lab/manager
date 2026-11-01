import { get } from './api.js';
import { h } from './ui.js';

/**
 * Bot selector used by every per-bot page. Remembers the last choice.
 * Calls onChange(bot) on user changes; callers invoke it once for the initial bot.
 */
export async function botPicker(onChange) {
  const { bots } = await get('/bots');
  const wrap = h('div', { class: 'picker' });

  if (!bots.length) {
    wrap.append(h('span', { class: 'muted' }, 'No bots registered yet. '), h('a', { href: 'bots.html' }, 'Add a bot first'));
    return { el: wrap, bots, current: () => null };
  }

  const saved = localStorage.getItem('eb_bot');
  const select = h('select', { id: 'botSelect' }, bots.map((b) => h('option', { value: b.id }, `${b.name} (@${b.username})`)));
  select.value = bots.some((b) => b.id === saved) ? saved : bots[0].id;
  const current = () => bots.find((b) => b.id === select.value) || null;
  select.addEventListener('change', () => {
    localStorage.setItem('eb_bot', select.value);
    onChange(current());
  });
  wrap.append(h('label', { for: 'botSelect' }, 'Bot'), select);
  return { el: wrap, bots, current };
}

/** Renders a Telegram-style message bubble with an inline keyboard. */
export function keyboardPreview({ text, rows, sampleBefore = [], sampleAfter = [] }) {
  const renderRow = (row, sample = false) =>
    h('div', { class: 'tg-row' }, row.map((b) => h('div', { class: `tg-btn ${sample ? 'sample' : ''}`, title: b.url || '' }, b.text)));
  const all = [
    ...sampleBefore.map((r) => renderRow(r, true)),
    ...rows.map((r) => renderRow(r)),
    ...sampleAfter.map((r) => renderRow(r, true)),
  ];
  return h('div', { class: 'tg-msg' }, h('div', { class: 'tg-text' }, text), all.length ? all : h('div', { class: 'muted' }, '(no buttons)'));
}

export const botStartLink = (bot, groupId) => `https://t.me/${bot.username}?start=v_${groupId}`;
