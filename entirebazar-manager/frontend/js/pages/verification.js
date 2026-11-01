import { initPage } from '../shell.js';
import { get, put } from '../api.js';
import { botPicker } from '../components.js';
import { h, pageHeader, toast, errorBox, errorMessage, createFields, emptyState } from '../ui.js';

const { content } = await initPage('verification', 'Verification Settings');
const body = h('div');
let bot = null;
let groupId = null;

const picker = await botPicker((b) => { bot = b; groupId = null; loadGroups(); });
bot = picker.current();
const groupSlot = h('span');
content.append(
  pageHeader('Verification Settings'),
  h('div', { class: 'picker' }, picker.el, groupSlot),
  body
);

async function loadGroups() {
  groupSlot.replaceChildren();
  body.replaceChildren();
  if (!bot) return;
  try {
    const { groups } = await get(`/groups?botId=${bot.id}`);
    if (!groups.length) {
      body.replaceChildren(emptyState('This bot has no groups yet. Add a group first.'));
      return;
    }
    const select = h('select', { id: 'groupSelect' }, groups.map((g) => h('option', { value: g.id }, g.title)));
    select.value = groups.some((g) => g.id === groupId) ? groupId : groups[0].id;
    select.addEventListener('change', () => { groupId = select.value; loadForm(); });
    groupId = select.value;
    groupSlot.replaceChildren(h('div', { class: 'picker' }, h('label', { for: 'groupSelect' }, 'Group'), select));
    loadForm();
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

async function loadForm() {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    const [{ settings: s }, { channels }] = await Promise.all([get(`/verification/${groupId}`), get(`/channels?botId=${bot.id}`)]);
    const enabledChannels = channels.filter((c) => c.enabled);
    const { el, read } = createFields([
      { name: 'enabled', label: 'Require verification for this group', type: 'checkbox', value: s.enabled,
        help: 'When off, the bot ignores join requests for this group and admins handle them manually.' },
      { name: 'requiredChannelIds', label: 'Required channels', type: 'checkboxes', value: s.requiredChannelIds,
        options: enabledChannels.map((c) => ({ value: c.id, label: c.title })), emptyText: 'No enabled channels for this bot. Add channels first.',
        help: 'Users must be a member of every selected channel.' },
      { name: 'verifyButtonText', label: 'Verify button text', value: s.verifyButtonText, maxlength: 40, required: true },
      { name: 'instructionText', label: 'Instruction message (sent privately)', type: 'textarea', value: s.instructionText, maxlength: 2000, required: true,
        help: 'Placeholders: {first_name} {username} {group_title} {bot_username}. The channel list is added automatically.' },
      { name: 'missingText', label: 'Message when channels are missing', type: 'textarea', value: s.missingText, maxlength: 1500, required: true,
        help: 'Placeholder {missing_channels} lists the channels still to join.' },
      { name: 'successText', label: 'Message after approval', type: 'textarea', value: s.successText, maxlength: 1000, required: true },
      { name: 'noRequestText', label: 'Message when no join request is found', type: 'textarea', value: s.noRequestText, maxlength: 1000, required: true,
        help: 'Shown when someone opens the DM fallback link without a pending request.' },
      { name: 'cooldownSeconds', label: 'Seconds between Verify presses', type: 'number', value: s.cooldownSeconds, min: 1, max: 300, required: true },
    ]);
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save settings');
    const form = h('form', { class: 'card' }, el, h('div', { class: 'actions' }, save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      try {
        await put(`/verification/${groupId}`, read());
        toast('Verification settings saved', 'success');
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally { save.disabled = false; }
    });
    body.replaceChildren(form);
  } catch (err) {
    body.replaceChildren(errorBox(err));
  }
}

loadGroups();
