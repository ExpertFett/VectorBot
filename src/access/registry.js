// Gated actions registry. Each entry is something a non-admin can be granted
// permission to do via Access Groups. Default for every action: admin-only
// (requires ManageGuild). Adding a new gateable action:
//   1. Append an entry here with a unique key and human-readable label/category
//   2. Call canPerform(member, ACTION_KEY) wherever the action is invoked
//   3. The dashboard's Access Groups page picks the list up automatically

export const ACTIONS = [
  // ── Events & ops ──
  { key: 'events.post',       category: 'Events',         label: 'Post / repost mission events',           hint: 'Anyone permitted here can hit Post in the Events tab and push an event to a channel.' },
  { key: 'events.manage',     category: 'Events',         label: 'Edit / delete mission events',           hint: 'Edit existing events, change slots, delete entirely.' },
  { key: 'announcements.send', category: 'Engagement',    label: 'Send announcements via /announce + Send Embed', hint: 'Includes the Send Embed dashboard page and the /announce slash command.' },
  { key: 'sticky.set',        category: 'Engagement',     label: 'Set sticky messages',                    hint: 'Sticky messages auto-repost to keep info pinned in active channels.' },
  { key: 'scheduled.create',  category: 'Engagement',     label: 'Create scheduled messages',              hint: 'Recurring or one-off scheduled posts.' },
  { key: 'giveaways.create',  category: 'Engagement',     label: 'Create giveaways',                       hint: 'Start, end, reroll giveaways.' },

  // ── Squadron management ──
  { key: 'roster.manage',     category: 'Squadron',       label: 'Edit pilot roster + qualifications',     hint: 'Set callsigns, airframes, qualifications, import CSV.' },
  { key: 'recruitment.review', category: 'Squadron',      label: 'Review applications',                    hint: 'See incoming applications and approve/reject them.' },
  { key: 'recruitment.manage', category: 'Squadron',      label: 'Manage recruitment panel + form',        hint: 'Edit the recruitment panel and the application questions.' },

  // ── Server identity & flow ──
  { key: 'welcome.manage',    category: 'Members',        label: 'Edit welcome / goodbye messages',        hint: 'Welcome card, goodbye card, autorole.' },
  { key: 'welcomepage.manage', category: 'Members',       label: 'Edit Welcome Channel landing page',      hint: 'The multi-element welcome page builder.' },
  { key: 'onboarding.manage', category: 'Members',        label: 'Edit onboarding wizard',                 hint: 'The Get Started panel + multi-step wizard.' },
  { key: 'verification.manage', category: 'Members',      label: 'Edit verification gate',                 hint: 'Verify panel, button label, role granted.' },
  { key: 'rolemenus.manage',  category: 'Members',        label: 'Edit reaction roles',                    hint: 'Create/edit role menus.' },

  // ── Moderation ──
  { key: 'tickets.manage',    category: 'Moderation',     label: 'Manage tickets panel + close tickets',   hint: 'Edit the tickets panel; close/reopen tickets from the dashboard.' },
  { key: 'automod.manage',    category: 'Moderation',     label: 'Configure auto-moderation',              hint: 'Spam / link / mention filters and their actions.' },

  // ── Customize ──
  { key: 'personalizer.manage', category: 'Customize',    label: 'Edit bot nickname + accent color',       hint: 'Per-server identity tweaks.' },
];

export const ACTION_BY_KEY = Object.fromEntries(ACTIONS.map((a) => [a.key, a]));

export function actionsByCategory() {
  const out = new Map();
  for (const a of ACTIONS) {
    if (!out.has(a.category)) out.set(a.category, []);
    out.get(a.category).push(a);
  }
  return [...out.entries()].map(([category, items]) => ({ category, items }));
}
