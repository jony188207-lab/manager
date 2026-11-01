'use strict';

const { MAX_BUTTONS_PER_ROW } = require('./constants');

/**
 * Turns stored button documents into Telegram inline keyboard rows.
 * Disabled buttons are skipped; rows/positions only decide ordering, so gaps are harmless.
 */
function buildButtonRows(buttons) {
  const active = (buttons || []).filter((b) => b && b.enabled !== false && b.label && b.url);
  active.sort(
    (a, b) =>
      (a.row || 0) - (b.row || 0) ||
      (a.position || 0) - (b.position || 0) ||
      String(a.id || '').localeCompare(String(b.id || ''))
  );
  const rows = [];
  let currentRow = null;
  for (const b of active) {
    const row = b.row || 0;
    if (row !== currentRow) {
      rows.push([]);
      currentRow = row;
    }
    const target = rows[rows.length - 1];
    if (target.length < MAX_BUTTONS_PER_ROW) target.push({ text: b.label, url: b.url });
  }
  return rows;
}

function buildInlineKeyboard({ before = [], buttons = [], after = [] } = {}) {
  return { inline_keyboard: [...before, ...buildButtonRows(buttons), ...after] };
}

/** Replaces {placeholders}. Unknown placeholders are left untouched. Output is plain text. */
function renderTemplate(text, vars = {}) {
  return String(text || '')
    .replace(/\{([a-z_]+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
    )
    .slice(0, 4096);
}

module.exports = { buildButtonRows, buildInlineKeyboard, renderTemplate };
