// Small DOM helpers. Everything is built with textContent/createElement (no innerHTML),
// so data coming from Telegram or the API can never inject markup.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  let pendingValue;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') pendingValue = v;
    else if (['checked', 'disabled', 'selected', 'required', 'hidden', 'multiple'].includes(k)) el[k] = true;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (pendingValue !== undefined) el.value = pendingValue;
  return el;
}

let timezone;
export function setTimezone(tz) {
  timezone = tz;
}
export function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(iso));
  } catch (_) {
    return String(iso);
  }
}

export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const t = h('div', { class: `toast ${kind}` }, message);
  box.append(t);
  setTimeout(() => t.remove(), 4500);
}

export function errorMessage(err) {
  let msg = (err && err.message) || 'Something went wrong';
  if (err && Array.isArray(err.details) && err.details.length) {
    msg += `: ${err.details.map((d) => `${d.field} ${d.message}`).join('; ')}`;
  }
  return msg;
}

export const errorBox = (err) => h('div', { class: 'form-error', role: 'alert' }, errorMessage(err));
export const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
export const emptyState = (text) => h('p', { class: 'empty' }, text);
export const pageHeader = (title, ...actions) =>
  h('div', { class: 'page-head' }, h('h1', {}, title), h('div', { class: 'page-actions' }, actions));

export function table({ columns, rows, empty = 'Nothing here yet.' }) {
  if (!rows.length) return emptyState(empty);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c.label)))),
      h(
        'tbody',
        {},
        rows.map((r) => h('tr', {}, columns.map((c) => h('td', { 'data-label': c.label }, c.render(r)))))
      )
    )
  );
}

export function copyButton(text, label = 'Copy') {
  return h('button', {
    class: 'btn btn-sm',
    type: 'button',
    onClick: async (e) => {
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = 'Copied';
        setTimeout(() => (e.target.textContent = label), 1500);
      } catch (_) {
        toast('Copy failed. Select the text manually.', 'error');
      }
    },
  }, label);
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', {});
    const done = (value) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg.append(
      h('h2', {}, title),
      h('p', {}, message),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => done(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onClick: () => done(true) }, confirmLabel)
      )
    );
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/**
 * Builds form controls from a field list. Types: text, password, url, email, number, textarea,
 * select, checkbox, checkboxes. Returns { el, read } where read() gives the current values.
 */
export function createFields(fields) {
  const inputs = {};
  const wrap = h('div', { class: 'fields' });

  for (const f of fields) {
    const id = `fld_${f.name}`;
    const help = f.help ? h('small', { class: 'help' }, f.help) : null;
    let input;

    if (f.type === 'checkbox') {
      input = h('input', { id, type: 'checkbox', checked: !!f.value });
      wrap.append(h('div', { class: 'field field-check' }, h('label', { for: id }, input, f.label), help));
      inputs[f.name] = input;
      continue;
    }
    if (f.type === 'textarea') {
      input = h('textarea', { id, rows: f.rows || 4, maxlength: f.maxlength, placeholder: f.placeholder, required: f.required, value: f.value ?? '' });
    } else if (f.type === 'select') {
      input = h('select', { id, value: f.value }, f.options.map((o) => h('option', { value: o.value }, o.label)));
    } else if (f.type === 'checkboxes') {
      const selected = f.value || [];
      input = h(
        'div',
        { class: 'checklist' },
        f.options.length
          ? f.options.map((o) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: o.value, checked: selected.includes(o.value) }), o.label))
          : h('span', { class: 'muted' }, f.emptyText || 'No options available')
      );
    } else {
      input = h('input', {
        id, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder, maxlength: f.maxlength,
        min: f.min, max: f.max, required: f.required, autocomplete: 'off', list: f.list,
      });
    }
    wrap.append(h('div', { class: 'field' }, h('label', { for: id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), input, help));
    inputs[f.name] = input;
  }

  const read = () => {
    const out = {};
    for (const f of fields) {
      const el = inputs[f.name];
      if (f.type === 'checkbox') out[f.name] = el.checked;
      else if (f.type === 'checkboxes') out[f.name] = [...el.querySelectorAll('input:checked')].map((i) => i.value);
      else if (f.type === 'number') {
        if (el.value !== '') out[f.name] = Number(el.value);
      } else {
        const value = el.value.trim();
        if (!(f.omitEmpty && value === '')) out[f.name] = value;
      }
    }
    return out;
  };
  return { el: wrap, read };
}

/** Modal form. Resolves true when saved, false when cancelled. */
export function formDialog({ title, description, fields, submitLabel = 'Save', onSubmit }) {
  return new Promise((resolve) => {
    let saved = false;
    const { el, read } = createFields(fields);
    const errBox = h('div', { class: 'form-error hidden', role: 'alert' });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);
    const dlg = h('dialog', {});
    const form = h(
      'form',
      {},
      h('h2', {}, title),
      description ? h('p', { class: 'muted' }, description) : null,
      el,
      errBox,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel'), submit)
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      errBox.classList.add('hidden');
      try {
        await onSubmit(read());
        saved = true;
        dlg.close();
      } catch (err) {
        errBox.textContent = errorMessage(err);
        errBox.classList.remove('hidden');
        submit.disabled = false;
      }
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(saved);
    });
    dlg.append(form);
    document.body.append(dlg);
    dlg.showModal();
  });
}
