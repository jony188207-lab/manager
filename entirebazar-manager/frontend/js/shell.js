import { auth, onAuthStateChanged, signOut } from './firebase.js';
import { get } from './api.js';
import { h, setTimezone, badge, errorMessage } from './ui.js';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: '▦' },
  { key: 'bots', label: 'Bots', href: 'bots.html', icon: '🤖' },
  { key: 'groups', label: 'Groups', href: 'groups.html', icon: '👥' },
  { key: 'channels', label: 'Channels', href: 'channels.html', icon: '📢' },
  { key: 'verification', label: 'Verification', href: 'verification.html', icon: '✅' },
  { key: 'buttons', label: 'Inline Buttons', href: 'buttons.html', icon: '🔘' },
  { key: 'welcome', label: 'Welcome Messages', href: 'welcome.html', icon: '💬' },
  { key: 'logs', label: 'Verification Logs', href: 'logs.html', icon: '📜' },
  { key: 'admins', label: 'Admins', href: 'admins.html', icon: '🛡', superOnly: true },
  { key: 'settings', label: 'General Settings', href: 'settings.html', icon: '⚙', superOnly: true },
];

const waitForUser = () =>
  new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => {
      off();
      resolve(user);
    });
  });

const never = () => new Promise(() => {});

function blockedScreen(err) {
  const unauthorized = err && (err.status === 401 || err.status === 403);
  document.body.replaceChildren(
    h(
      'div',
      { class: 'auth-wrap' },
      h(
        'div',
        { class: 'card auth-card' },
        h('h1', {}, unauthorized ? 'Access denied' : 'Cannot load the panel'),
        h('p', { class: 'muted' }, unauthorized ? 'This account is not an active admin. Ask a super admin to add you.' : errorMessage(err)),
        h('div', { class: 'actions' },
          unauthorized ? null : h('button', { class: 'btn btn-primary', onClick: () => location.reload() }, 'Retry'),
          h('button', { class: 'btn', onClick: async () => { await signOut(auth); location.replace('index.html'); } }, 'Sign out'))
      )
    )
  );
}

/** Guards the page (sign-in + admin check), renders the layout and returns { me, content }. */
export async function initPage(pageKey, title) {
  const user = await waitForUser();
  if (!user) {
    location.replace('index.html');
    return never();
  }

  let me;
  try {
    me = await get('/me');
  } catch (err) {
    blockedScreen(err);
    return never();
  }
  setTimezone(me.settings.timezone);
  document.title = `${title} · ${me.settings.panelName}`;

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' });
  const overlay = h('div', { class: 'overlay hidden' });
  const closeMenu = () => {
    sidebar.classList.remove('open');
    overlay.classList.add('hidden');
  };
  overlay.addEventListener('click', closeMenu);

  sidebar.append(
    h('div', { class: 'brand' }, me.settings.panelName),
    h(
      'nav',
      { class: 'nav' },
      NAV.filter((n) => !n.superOnly || me.role === 'super_admin').map((n) =>
        h('a', { href: n.href, class: n.key === pageKey ? 'active' : '' }, h('span', {}, n.icon), n.label)
      )
    ),
    h(
      'div',
      { class: 'sidebar-foot' },
      h('div', {}, me.email || ''),
      h('div', {}, badge(me.role === 'super_admin' ? 'Super admin' : 'Admin', 'info')),
      h('button', {
        class: 'btn btn-sm',
        onClick: async () => {
          await signOut(auth);
          location.replace('index.html');
        },
      }, 'Sign out')
    )
  );

  const content = h('main', { class: 'content' });
  const menuBtn = h('button', {
    class: 'btn menu-btn', type: 'button', 'aria-label': 'Open menu',
    onClick: () => {
      sidebar.classList.add('open');
      overlay.classList.remove('hidden');
    },
  }, '☰');

  document.body.replaceChildren(
    h('div', { class: 'shell' }, sidebar, overlay,
      h('div', { class: 'main' }, h('header', { class: 'topbar' }, menuBtn, h('span', { class: 'title' }, title)), content))
  );
  return { me, content };
}
