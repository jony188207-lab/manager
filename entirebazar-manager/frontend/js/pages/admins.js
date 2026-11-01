import { initPage } from '../shell.js';
import { get, post, patch, del } from '../api.js';
import { h, pageHeader, table, badge, fmtDate, toast, errorBox, errorMessage, confirmDialog, formDialog } from '../ui.js';

const { me, content } = await initPage('admins', 'Admin Management');
const body = h('div');

if (me.role !== 'super_admin') {
  content.append(pageHeader('Admin Management'), errorBox({ message: 'Only super admins can manage admins.' }));
} else {
  content.append(
    pageHeader('Admin Management', h('button', { class: 'btn btn-primary', onClick: add }, '+ Add admin')),
    h('div', { class: 'notice info' }, 'Create the person in Firebase Console → Authentication → Users first, then grant them access here. Roles are stored and checked on the server.'),
    body
  );
  load();
}

async function load() {
  try {
    const { admins } = await get('/admins');
    body.replaceChildren(table({
      rows: admins,
      columns: [
        { label: 'Email', render: (a) => a.uid === me.uid ? `${a.email} (you)` : a.email },
        { label: 'Role', render: (a) => badge(a.role === 'super_admin' ? 'Super admin' : 'Admin', a.role === 'super_admin' ? 'info' : '') },
        { label: 'Status', render: (a) => badge(a.active ? 'Active' : 'Disabled', a.active ? 'success' : 'warn') },
        { label: 'Added', render: (a) => fmtDate(a.createdAt) },
        { label: 'Actions', render: (a) => a.uid === me.uid ? '—' : h('div', { class: 'actions' },
          h('button', { class: 'btn btn-sm', onClick: () => update(a, { role: a.role === 'admin' ? 'super_admin' : 'admin' }, 'Role updated') }, a.role === 'admin' ? 'Make super admin' : 'Make admin'),
          h('button', { class: 'btn btn-sm', onClick: () => update(a, { active: !a.active }, a.active ? 'Admin disabled' : 'Admin enabled') }, a.active ? 'Disable' : 'Enable'),
          h('button', { class: 'btn btn-sm btn-danger', onClick: () => remove(a) }, 'Remove')) },
      ],
    }));
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

async function add() {
  const saved = await formDialog({
    title: 'Add admin', submitLabel: 'Grant access',
    fields: [
      { name: 'email', label: 'Email (existing Firebase user)', type: 'email', required: true },
      { name: 'role', label: 'Role', type: 'select', value: 'admin', options: [{ value: 'admin', label: 'Admin' }, { value: 'super_admin', label: 'Super admin' }] },
    ],
    onSubmit: (v) => post('/admins', v),
  });
  if (saved) { toast('Admin added', 'success'); load(); }
}

async function update(a, changes, message) {
  try { await patch(`/admins/${a.uid}`, changes); toast(message, 'success'); load(); }
  catch (err) { toast(errorMessage(err), 'error'); }
}

async function remove(a) {
  const ok = await confirmDialog({ title: `Remove ${a.email}?`, danger: true, confirmLabel: 'Remove', message: 'They will lose access to the panel immediately. Their Firebase account is not deleted.' });
  if (!ok) return;
  try { await del(`/admins/${a.uid}`); toast('Admin removed', 'success'); load(); }
  catch (err) { toast(errorMessage(err), 'error'); }
}
