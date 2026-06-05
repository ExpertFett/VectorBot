import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import {
  getEvent, getSignups, getUserSignups, setSignup, removeUserRole, removeAllUserSignups,
  countRoleSignups, setEventMessage, getPersonalization, getRosterEntry,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';

const BUTTON_LIMIT = 20;
const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

function groupRoles(roles) {
  const order = [];
  const map = new Map();
  roles.forEach((role, index) => {
    const g = role.group || '';
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g).push({ role, index });
  });
  return order.map((name) => ({ name, items: map.get(name) }));
}

export function buildEventMessage(event, signups = []) {
  const accent = getPersonalization(event.guild_id).embed_color ?? 0x5865f2;
  const cancelled = event.status === 'cancelled';
  const completed = event.status === 'completed';
  const closed = cancelled || completed;
  const prefix = cancelled ? '[CANCELLED] ' : completed ? '[COMPLETED] ' : '';
  const closedColor = cancelled ? 0xf23f43 : 0x4f545c; // red for cancelled, slate for completed
  const ts = Math.floor(event.start_at / 1000);

  let embed = event.embed ? buildEmbed(event.embed, undefined, accent) : null;
  if (embed) {
    if (!embed.data.title) embed.setTitle(event.title);
    if (closed) { embed.setColor(closedColor); embed.setTitle(`${prefix}${embed.data.title}`); }
  } else {
    embed = new EmbedBuilder()
      .setColor(closed ? closedColor : accent)
      .setTitle(`${prefix}${event.title}`)
      .setDescription(event.description || null);
    const meta = [];
    if (event.mission) meta.push({ name: 'Mission', value: event.mission, inline: true });
    if (event.map) meta.push({ name: 'Map', value: event.map, inline: true });
    if (meta.length) embed.addFields(meta);
  }
  embed.addFields({ name: 'When', value: `<t:${ts}:F>\n<t:${ts}:R>`, inline: false });

  const byRole = new Map();
  for (const s of signups) {
    if (!byRole.has(s.role_label)) byRole.set(s.role_label, []);
    byRole.get(s.role_label).push(s.user_id);
  }
  // active = first `limit` by sign-up time; the rest are waitlisted.
  const split = (role) => {
    const ids = byRole.get(role.label) || [];
    const active = role.limit ? ids.slice(0, role.limit) : ids;
    const waiting = role.limit ? ids.slice(role.limit) : [];
    return { active, waiting, cap: role.limit ? `/${role.limit}` : '' };
  };
  const mention = (ids) => (ids.length ? ids.map((id) => `<@${id}>`).join(', ') : '—');

  const roles = event.roles || [];
  const taskings = event.taskings || {};
  const hasGroups = roles.some((r) => r.group);
  // Use direct buttons only when the event is small AND has no flight grouping
  // (e.g. a simple Attending/Maybe RSVP). Otherwise compact group-button flow.
  const useDirectButtons = !hasGroups && roles.length <= BUTTON_LIMIT;

  if (useDirectButtons) {
    for (const role of roles) {
      const { active, waiting, cap } = split(role);
      let val = active.length ? active.map((id) => `<@${id}>`).join('\n') : '—';
      if (waiting.length) val += `\n*WL:* ${mention(waiting)}`;
      embed.addFields({ name: `${role.emoji ? role.emoji + ' ' : ''}${role.label}${role.qual ? ' 🔒' : ''} (${active.length}${cap})`, value: val.slice(0, 1024), inline: true });
    }
  } else {
    // Compact: per flight, show only filled slots (open ones live behind the button).
    for (const grp of groupRoles(roles).slice(0, 24)) {
      const cap = grp.items.reduce((n, { role }) => n + (role.limit || 0), 0);
      let filled = 0;
      const lines = [];
      for (const { role } of grp.items) {
        const { active, waiting } = split(role);
        filled += active.length;
        if (active.length) {
          let lbl = role.label;
          if (grp.name && lbl.startsWith(grp.name)) lbl = lbl.slice(grp.name.length).replace(/^[\s–-]+/, '') || role.label;
          lines.push(`${lbl}: ${mention(active)}${waiting.length ? ` *(+${waiting.length} WL)*` : ''}`);
        }
      }
      const tasking = taskings[grp.name];
      const flight = grp.name || 'Slots';
      const header = `${tasking ? `${tasking} — ` : ''}${flight}${cap ? ` (${filled}/${cap})` : ` (${filled})`}`;
      embed.addFields({ name: header, value: lines.length ? lines.join('\n').slice(0, 1024) : '*all open*', inline: true });
    }
  }

  if (!event.embed && isHttpUrl(event.image)) embed.setImage(event.image);
  const flags = [event.multi_signup ? 'multi-slot' : '1 slot/person', event.waitlist ? 'waitlist on' : null].filter(Boolean).join(' · ');
  embed.setFooter({ text: `Event #${event.id} · ${flags}` });

  if (closed) return { embeds: [embed], components: [] };

  const rows = [];
  if (useDirectButtons) {
    let row = new ActionRowBuilder();
    roles.forEach((role, i) => {
      if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
      const btn = new ButtonBuilder().setCustomId(`event:${event.id}:r:${i}`).setLabel(role.label.slice(0, 80)).setStyle(ButtonStyle.Primary);
      if (role.emoji) { try { btn.setEmoji(role.emoji); } catch { /* invalid */ } }
      row.components.push(btn);
    });
    if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
    row.components.push(new ButtonBuilder().setCustomId(`event:${event.id}:withdraw`).setLabel('Withdraw').setStyle(ButtonStyle.Secondary).setEmoji('🚫'));
    rows.push(row);
  } else {
    // One button per flight group; clicking it asks which slot (keeps the message compact).
    const groups = groupRoles(roles).slice(0, 23);
    let row = new ActionRowBuilder();
    groups.forEach((grp, gi) => {
      if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
      const filled = grp.items.reduce((n, { role }) => n + split(role).active.length, 0);
      const cap = grp.items.reduce((n, { role }) => n + (role.limit || 0), 0);
      const tasking = taskings[grp.name];
      const flight = grp.name || 'Slots';
      const label = tasking ? `${tasking}: ${flight}` : flight;
      row.components.push(new ButtonBuilder()
        .setCustomId(`event:${event.id}:grp:${gi}`)
        .setLabel(`${label} (${filled}${cap ? `/${cap}` : ''})`.slice(0, 80))
        .setStyle(ButtonStyle.Primary));
    });
    if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
    row.components.push(new ButtonBuilder().setCustomId(`event:${event.id}:withdraw`).setLabel('Withdraw').setStyle(ButtonStyle.Secondary).setEmoji('🚫'));
    rows.push(row);
  }

  return { embeds: [embed], components: rows };
}

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
}

export async function postEvent(client, event) {
  const channel = await resolveChannel(client, event.channel_id);
  if (!channel?.isTextBased()) throw new Error('invalid_channel');
  const payload = buildEventMessage(event, getSignups(event.id));
  if (event.message_id) {
    const existing = await channel.messages.fetch(event.message_id).catch(() => null);
    if (existing) { await existing.edit(payload); setEventMessage(event.id, channel.id, existing.id); return existing.id; }
  }
  const sent = await channel.send(payload);
  setEventMessage(event.id, channel.id, sent.id);
  return sent.id;
}

async function rerender(interaction, eventId) {
  const fresh = getEvent(eventId);
  if (fresh) await interaction.message.edit(buildEventMessage(fresh, getSignups(eventId))).catch(() => {});
}

// Re-render the main event message by its stored id (used when the interaction
// is on an ephemeral slot-picker, not the event message itself).
async function rerenderStored(client, eventId) {
  const ev = getEvent(eventId);
  if (!ev?.channel_id || !ev?.message_id) return;
  const ch = await resolveChannel(client, ev.channel_id);
  if (!ch?.isTextBased()) return;
  const msg = await ch.messages.fetch(ev.message_id).catch(() => null);
  if (msg) await msg.edit(buildEventMessage(ev, getSignups(eventId))).catch(() => {});
}

// Snapshot active (non-waitlisted) user per role for promotion detection.
function activeSets(event) {
  const byRole = new Map();
  for (const s of getSignups(event.id)) {
    if (!byRole.has(s.role_label)) byRole.set(s.role_label, []);
    byRole.get(s.role_label).push(s.user_id);
  }
  const out = new Map();
  for (const role of event.roles) {
    const ids = byRole.get(role.label) || [];
    out.set(role.label, new Set(role.limit ? ids.slice(0, role.limit) : ids));
  }
  return out;
}

// Run a DB mutation; if the event has a waitlist, DM anyone newly promoted into an active slot.
async function withPromotion(client, event, mutate) {
  if (!event.waitlist) { mutate(); return; }
  const before = activeSets(event);
  mutate();
  const after = activeSets(event);
  for (const role of event.roles) {
    const b = before.get(role.label) || new Set();
    for (const uid of after.get(role.label) || new Set()) {
      if (!b.has(uid)) {
        client.users.fetch(uid)
          .then((u) => u.send(`✅ You've been promoted from the waitlist into **${role.label}** for **${event.title}**.`))
          .catch(() => {});
      }
    }
  }
}

// Does the member hold the qualification this slot requires? Quals are free text
// on the roster; match the requirement as a case-insensitive substring.
function meetsQual(event, userId, role) {
  if (!role.qual) return true;
  const quals = (getRosterEntry(event.guild_id, userId)?.quals || '').toLowerCase();
  return quals.includes(role.qual.toLowerCase());
}

function claim(event, userId, role) {
  const mine = getUserSignups(event.id, userId).map((s) => s.role_label);
  if (mine.includes(role.label)) {
    removeUserRole(event.id, userId, role.label);
    return { changed: true, msg: `Removed you from **${role.label}**.` };
  }
  if (!meetsQual(event, userId, role)) {
    return { changed: false, msg: `🔒 **${role.label}** requires the **${role.qual}** qualification. Ask staff if you should have it on the roster.` };
  }
  const full = role.limit && countRoleSignups(event.id, role.label) >= role.limit;
  if (full && !event.waitlist) return { changed: false, msg: `**${role.label}** is full.` };
  if (!event.multi_signup) removeAllUserSignups(event.id, userId);
  setSignup(event.id, userId, role.label);
  return { changed: true, msg: full ? `Added to the **waitlist** for **${role.label}**.` : `You’re signed up as **${role.label}**.` };
}

export async function handleEventButton(interaction) {
  const [, idStr, action, idxStr] = interaction.customId.split(':');
  const event = getEvent(Number(idStr));
  if (!event || event.status !== 'scheduled') {
    return interaction.reply({ content: 'This event is no longer open.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'withdraw') {
    let removed = 0;
    await withPromotion(interaction.client, event, () => { removed = removeAllUserSignups(event.id, interaction.user.id); });
    await rerender(interaction, event.id);
    return interaction.reply({ content: removed ? 'You’ve withdrawn.' : 'You weren’t signed up.', flags: MessageFlags.Ephemeral });
  }

  // Group button -> ephemeral slot picker for that flight.
  if (action === 'grp') {
    const grp = groupRoles(event.roles).slice(0, 23)[Number(idxStr)];
    if (!grp) return interaction.reply({ content: 'That flight no longer exists.', flags: MessageFlags.Ephemeral });

    // Single-slot flight (a controller, solo recon jet, etc.) — claim directly,
    // no picker. Matches the user expectation that one click = one sign-up.
    if (grp.items.length === 1) {
      const role = grp.items[0].role;
      let result;
      await withPromotion(interaction.client, event, () => { result = claim(event, interaction.user.id, role); });
      if (result.changed) await rerender(interaction, event.id);
      return interaction.reply({ content: result.msg, flags: MessageFlags.Ephemeral });
    }

    // One button per slot — green ✓ if the member already holds it, disabled
    // grey if it's full (and no waitlist), blue otherwise. Max 25 buttons (5×5).
    const tasking = (event.taskings || {})[grp.name];
    const flightLabel = `${tasking ? `${tasking} — ` : ''}${grp.name || 'this flight'}`;
    const myLabels = new Set(getUserSignups(event.id, interaction.user.id).map((s) => s.role_label));
    const rows = [];
    let row = new ActionRowBuilder();
    for (const { role, index } of grp.items.slice(0, 25)) {
      if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
      const taken = countRoleSignups(event.id, role.label);
      const cap = role.limit;
      const isFull = cap > 0 && taken >= cap;
      const isMine = myLabels.has(role.label);
      const countStr = cap > 0 ? `${taken}/${cap}` : `${taken}`;
      const label = `${role.label} (${countStr})${isMine ? ' ✓' : ''}`.slice(0, 80);
      let style = ButtonStyle.Primary;
      if (isMine) style = ButtonStyle.Success;
      else if (isFull && !event.waitlist) style = ButtonStyle.Secondary;
      const btn = new ButtonBuilder().setCustomId(`event:${event.id}:pr:${index}`).setLabel(label).setStyle(style);
      if (role.emoji) { try { btn.setEmoji(role.emoji); } catch { /* invalid */ } }
      if (isFull && !event.waitlist && !isMine) btn.setDisabled(true);
      row.components.push(btn);
    }
    if (row.components.length) rows.push(row);

    let content = `**${flightLabel}** — click a slot to toggle your sign-up.`;
    const qualNotes = grp.items.filter(({ role }) => role.qual).map(({ role }) => `· ${role.label}: 🔒 ${role.qual}`);
    if (qualNotes.length) content += `\n${qualNotes.join('\n')}`;
    return interaction.reply({ content, components: rows, flags: MessageFlags.Ephemeral });
  }

  // Picker-slot button click (inside the ephemeral slot picker).
  if (action === 'pr') {
    const role = event.roles[Number(idxStr)];
    if (!role) return interaction.update({ content: 'That slot no longer exists.', components: [] }).catch(() => {});
    let result;
    await withPromotion(interaction.client, event, () => { result = claim(event, interaction.user.id, role); });
    if (result.changed) await rerenderStored(interaction.client, event.id);
    return interaction.update({ content: result.msg, components: [] }).catch(() => {});
  }

  const role = event.roles[Number(idxStr)];
  if (!role) return interaction.reply({ content: 'That slot no longer exists.', flags: MessageFlags.Ephemeral });
  let result;
  await withPromotion(interaction.client, event, () => { result = claim(event, interaction.user.id, role); });
  if (result.changed) await rerender(interaction, event.id);
  return interaction.reply({ content: result.msg, flags: MessageFlags.Ephemeral });
}

// The slot-picker select lives in an ephemeral message, so we update that
// ephemeral reply and re-render the main event message by its stored id.
export async function handleEventSelect(interaction) {
  const [, idStr] = interaction.customId.split(':');
  const event = getEvent(Number(idStr));
  if (!event || event.status !== 'scheduled') {
    return interaction.update({ content: 'This event is no longer open.', components: [] }).catch(() => {});
  }
  if (interaction.values.length === 0) {
    return interaction.update({ content: 'No slot selected — use the Withdraw button on the event to leave.', components: [] });
  }
  const role = event.roles[Number(interaction.values[0])];
  if (!role) return interaction.update({ content: 'That slot no longer exists.', components: [] });
  let result;
  await withPromotion(interaction.client, event, () => { result = claim(event, interaction.user.id, role); });
  if (result.changed) await rerenderStored(interaction.client, event.id);
  return interaction.update({ content: result.msg, components: [] });
}
