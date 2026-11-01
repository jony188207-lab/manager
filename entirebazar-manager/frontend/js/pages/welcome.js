import { initPage } from '../shell.js';
import { get, put, qs } from '../api.js';
import { botPicker, keyboardPreview } from '../components.js';
import { h, pageHeader, toast, errorBox, errorMessage, createFields } from '../ui.js';

const { content } = await initPage('welcome', 'Welcome Message Editor');
const body = h('div');
let bot = null;

const picker = await botPicker((b) => { bot = b; load(); });
bot = picker.current();
content.append(pageHeader('Welcome Message Editor'), picker.el, body);

const HELP = 'Placeholders: {first_name} {username} {group_title} {bot_username}. Sent as plain text.';
const sample = (text) => text
  .replaceAll('{first_name}', 'Ana').replaceAll('{username}', '@ana')
  .replaceAll('{group_title}', 'Bazar Group').replaceAll('{bot_username}', `@${bot.username}`);

async function load() {
  if (!bot) return;
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    const [{ welcome: w }, kb] = await Promise.all([get(`/welcome/${bot.id}`), get(`/buttons/preview${qs({ botId: bot.id, placement: 'welcome' })}`)]);

    const group = createFields([
      { name: 'enabled', label: 'Post a welcome message in the group after a member is approved', type: 'checkbox', value: w.groupWelcome.enabled },
      { name: 'text', label: 'Group welcome text', type: 'textarea', value: w.groupWelcome.text, maxlength: 2000, required: true, help: HELP },
    ]);
    const priv = createFields([
      { name: 'enabled', label: 'Reply with a welcome message when someone starts the bot (/start)', type: 'checkbox', value: w.privateWelcome.enabled },
      { name: 'text', label: 'Private welcome text', type: 'textarea', value: w.privateWelcome.text, maxlength: 2000, required: true, help: HELP },
    ]);

    const preview = h('div');
    const renderPreview = () => preview.replaceChildren(
      h('h2', {}, 'Group message preview'), keyboardPreview({ text: sample(group.read().text || ''), rows: kb.inline_keyboard }),
      h('h2', {}, 'Private message preview'), keyboardPreview({ text: sample(priv.read().text || ''), rows: kb.inline_keyboard })
    );

    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save welcome messages');
    const form = h('form', {},
      h('div', { class: 'grid-2' },
        h('div', {},
          h('div', { class: 'card' },
            h('h2', {}, 'Group welcome (public)'),
            h('div', { class: 'notice' }, 'Telegram cannot show a group message to only the new member. Everyone in the group sees this message, so keep it generic.'),
            group.el),
          h('div', { class: 'card' },
            h('h2', {}, 'Private bot message'),
            h('div', { class: 'notice info' }, 'Sent in a private chat with the user. Only works for people who have started the bot.'),
            priv.el),
          h('div', { class: 'actions' }, save)),
        h('div', { class: 'card' }, preview, h('p', { class: 'help' }, 'Buttons come from Inline Buttons → Welcome messages.')))
    );
    form.addEventListener('input', renderPreview);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      try {
        await put(`/welcome/${bot.id}`, { groupWelcome: group.read(), privateWelcome: priv.read() });
        toast('Welcome messages saved', 'success');
      } catch (err) { toast(errorMessage(err), 'error'); }
      finally { save.disabled = false; }
    });
    renderPreview();
    body.replaceChildren(form);
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

load();
