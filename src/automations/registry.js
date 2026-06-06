// Trigger + action registry for the Automations engine. Each entry describes a
// shape the dashboard can present and the engine can validate. Add a new entry
// here, hook the trigger in src/events/, and the new rule type is available.
//
// Trigger context shape (passed to every action):
//   { guild, member?, user?, message?, role?, channel?, vars }
//   - guild: discord.js Guild (always present)
//   - member: GuildMember if the trigger involves a member
//   - user: User shortcut (member.user when present)
//   - message: Message for message-triggered rules
//   - role: Role for role-add/remove triggers
//   - vars: { user, username, displayname, server, ... } for placeholder substitution

export const TRIGGERS = [
  {
    key: 'member.join',
    label: 'A member joins the server',
    category: 'Members',
    params: [],
  },
  {
    key: 'member.leave',
    label: 'A member leaves the server',
    category: 'Members',
    params: [],
  },
  {
    key: 'member.role_added',
    label: 'A specific role is added to a member',
    category: 'Members',
    params: [{ key: 'role_id', label: 'Role', type: 'role', required: true }],
  },
  {
    key: 'member.role_removed',
    label: 'A specific role is removed from a member',
    category: 'Members',
    params: [{ key: 'role_id', label: 'Role', type: 'role', required: true }],
  },
  {
    key: 'verification.passed',
    label: 'A member completes verification',
    category: 'Members',
    params: [],
  },
  {
    key: 'message.keyword',
    label: 'A message contains specific text',
    category: 'Messages',
    params: [
      { key: 'keyword', label: 'Keyword or phrase (case-insensitive)', type: 'text', required: true, placeholder: 'help me' },
      { key: 'channel_id', label: 'Limit to a channel (optional)', type: 'channel', required: false },
    ],
  },
  {
    key: 'ticket.opened',
    label: 'A support ticket is opened',
    category: 'Tickets',
    params: [],
  },
  {
    key: 'ticket.closed',
    label: 'A support ticket is closed',
    category: 'Tickets',
    params: [],
  },
];

export const TRIGGER_BY_KEY = Object.fromEntries(TRIGGERS.map((t) => [t.key, t]));

export const ACTIONS = [
  {
    key: 'send.message',
    label: 'Send a message to a channel',
    params: [
      { key: 'channel_id', label: 'Channel', type: 'channel', required: true },
      { key: 'content', label: 'Message text (supports placeholders)', type: 'textarea', required: true,
        placeholder: 'Welcome {user}! Read the rules in <#…> to get started.' },
    ],
  },
  {
    key: 'send.dm',
    label: 'Send a DM to the triggering user',
    appliesTo: ['member.join', 'member.leave', 'member.role_added', 'member.role_removed', 'verification.passed', 'message.keyword', 'ticket.opened', 'ticket.closed'],
    params: [
      { key: 'content', label: 'DM text (supports placeholders)', type: 'textarea', required: true,
        placeholder: 'Welcome aboard, {displayname}!' },
    ],
  },
  {
    key: 'role.add',
    label: 'Give the triggering user a role',
    appliesTo: ['member.join', 'member.role_added', 'verification.passed', 'message.keyword', 'ticket.opened'],
    params: [
      { key: 'role_id', label: 'Role to add', type: 'role', required: true },
    ],
  },
  {
    key: 'role.remove',
    label: 'Remove a role from the triggering user',
    appliesTo: ['member.join', 'member.role_added', 'verification.passed', 'message.keyword', 'ticket.opened'],
    params: [
      { key: 'role_id', label: 'Role to remove', type: 'role', required: true },
    ],
  },
  {
    key: 'react.emoji',
    label: 'React to the triggering message',
    appliesTo: ['message.keyword'],
    params: [
      { key: 'emoji', label: 'Emoji', type: 'text', required: true, placeholder: '🫡' },
    ],
  },
  {
    key: 'delete.message',
    label: 'Delete the triggering message',
    appliesTo: ['message.keyword'],
    params: [],
  },
];

export const ACTION_BY_KEY = Object.fromEntries(ACTIONS.map((a) => [a.key, a]));

// Which actions are valid for a given trigger? Empty appliesTo = all triggers.
export function actionsForTrigger(triggerKey) {
  return ACTIONS.filter((a) => !a.appliesTo || a.appliesTo.includes(triggerKey));
}
