import { initPage } from '../shell.js';
import { get, put } from '../api.js';
import { h, pageHeader, toast, errorBox, errorMessage, createFields, copyButton } from '../ui.js';

const { me, content } = await initPage('settings', 'General Settings');
content.append(pageHeader('General Settings'));

if (me.role !== 'super_admin') {
  content.append(errorBox({ message: 'Only super admins can change general settings.' }));
} else {
  try {
    const { settings: s, serverInfo } = await get('/settings/general');
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
    const { el, read } = createFields([
      { name: 'panelName', label: 'Panel name', value: s.panelName, required: true, maxlength: 60 },
      { name: 'timezone', label: 'Time zone for dates', value: s.timezone, required: true, list: 'zones', help: 'IANA name, e.g. Asia/Dhaka or UTC.' },
      { name: 'logRetentionDays', label: 'Log retention (days)', type: 'number', value: s.logRetentionDays, min: 1, max: 365, required: true,
        help: 'Used by "Purge old logs" on the Logs page.' },
    ]);
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save settings');
    const form = h('form', { class: 'card' },
      h('datalist', { id: 'zones' }, zones.map((z) => h('option', { value: z }))),
      el, h('div', { class: 'actions' }, save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      try {
        await put('/settings/general', read());
        toast('Settings saved. Reload to apply the new name and time zone.', 'success');
      } catch (err) { toast(errorMessage(err), 'error'); }
      finally { save.disabled = false; }
    });
    content.append(
      form,
      h('div', { class: 'card' },
        h('h2', {}, 'Server'),
        h('p', {}, 'Public backend URL (used for Telegram webhooks):'),
        h('p', { class: 'mono' }, serverInfo.publicBaseUrl),
        copyButton(serverInfo.publicBaseUrl))
    );
  } catch (err) {
    content.append(errorBox(err));
  }
}
