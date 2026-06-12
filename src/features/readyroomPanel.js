// Renders + drives the sign-up panel for events PUBLISHED FROM READYROOM.
//
// ReadyRoom is the single source of truth: the bot holds NO sign-up state for
// these events. It renders from the payload ReadyRoom sends (publish / edit /
// click-response) and forwards every click back to ReadyRoom, then re-renders
// from the authoritative panel ReadyRoom returns. No second store to drift.
//
// Two-level sign-up flow (like a real flight brief):
//   main message  -> one button PER FLIGHT  (rr:<eid>:f:<groupIndex>)
//   click a flight -> ephemeral SLOT picker (rr:<eid>:s:<roleIndex>) — Flight
//                     Lead / Dash 2 / Section Lead / Dash 4 …
//   plus a Withdraw button on the main message (rr:<eid>:wd)

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { getConfig } from '../db/index.js';

const KIND_COLOR = { extra_credit: 0xf0b429, mission: 0x8a63ff };
const DEFAULT_COLOR = 0x4c8bf5;

// Slot labels are stored "<Flight> <Position>" (unique across the event). In a
// flight-scoped context we strip the flight prefix so the button just reads
// "Flight Lead", "Section Lead", etc.
const slotDisplay = (label, group) =>
  (group && label.startsWith(group + ' ') ? label.slice(group.length + 1) : label);

// Group roles into flights, keeping each slot's original index (for customIds)
// and the flight's order (for the flight-button index).
function group(panel) {
  const roles = Array.isArray(panel.roles) ? panel.roles : [];
  const signups = Array.isArray(panel.signups) ? panel.signups : [];
  const flights = [];
  const byGroup = new Map();
  roles.forEach((r, idx) => {
    const g = r.group || 'Slots';
    if (!byGroup.has(g)) { byGroup.set(g, []); flights.push(g); }
    byGroup.get(g).push({ ...r, idx });
  });
  const byRole = new Map();
  for (const s of signups) {
    if (!byRole.has(s.role_label)) byRole.set(s.role_label, []);
    byRole.get(s.role_label).push(s);
  }
  return { flights, byGroup, byRole };
}
const nameOf = (s) => s.callsign || s.display_name || 'pilot';

// ---- main message -------------------------------------------------------
export function buildReadyroomPanel(p) {
  const { flights, byGroup, byRole } = group(p);
  const taskings = p.taskings || {};
  const ts = Number.isFinite(Number(p.start_at)) ? Math.floor(Number(p.start_at) / 1000) : null;

  const embed = new EmbedBuilder()
    .setColor(KIND_COLOR[p.kind] ?? DEFAULT_COLOR)
    .setTitle(((p.kind === 'extra_credit' ? '⭐ ' : '') + String(p.title || 'Event')).slice(0, 256));
  if (p.url) embed.setURL(String(p.url).slice(0, 500));
  if (p.description) embed.setDescription(String(p.description).slice(0, 1800));
  if (ts) embed.addFields({ name: 'When', value: `<t:${ts}:F> · <t:${ts}:R>`, inline: false });

  for (const flight of flights.slice(0, 24)) {
    const slots = byGroup.get(flight);
    const tasking = taskings[flight];
    const filled = slots.reduce((n, r) => n + (byRole.get(r.label)?.length || 0), 0);
    const cap = slots.reduce((n, r) => n + (r.limit || 0), 0);
    const lines = slots.map((r) => {
      const occ = byRole.get(r.label) || [];
      return `${slotDisplay(r.label, flight)}${r.qual ? ' 🔒' : ''}: ${occ.length ? occ.map(nameOf).join(', ') : '—'}`;
    });
    embed.addFields({ name: `${tasking ? `${tasking} — ` : ''}${flight} (${filled}/${cap})`.slice(0, 256), value: (lines.join('\n') || '—').slice(0, 1024), inline: true });
  }
  embed.setFooter({ text: 'Pick a flight below to choose a slot · synced with ReadyRoom' });

  if (!flights.length) return { embeds: [embed], components: [] };

  // one button per flight (+ Withdraw), max 25 components
  const rows = [];
  let row = new ActionRowBuilder();
  flights.slice(0, 24).forEach((flight, gi) => {
    if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
    const slots = byGroup.get(flight);
    const filled = slots.reduce((n, r) => n + (byRole.get(r.label)?.length || 0), 0);
    const cap = slots.reduce((n, r) => n + (r.limit || 0), 0);
    const tasking = taskings[flight];
    row.components.push(new ButtonBuilder()
      .setCustomId(`rr:${p.readyroom_event_id}:f:${gi}`)
      .setLabel(`${tasking ? `${tasking}: ` : ''}${flight} (${filled}${cap ? `/${cap}` : ''})`.slice(0, 80))
      .setStyle(ButtonStyle.Primary));
  });
  if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
  row.components.push(new ButtonBuilder()
    .setCustomId(`rr:${p.readyroom_event_id}:wd`).setLabel('Withdraw').setStyle(ButtonStyle.Danger).setEmoji('🚫'));
  rows.push(row);
  return { embeds: [embed], components: rows };
}

// ---- ephemeral slot picker for one flight -------------------------------
export function buildSlotPicker(p, groupIndex, userId) {
  const { flights, byGroup, byRole } = group(p);
  const flight = flights[groupIndex];
  if (!flight) return null;
  const myLabels = new Set((p.signups || [])
    .filter((s) => String(s.discord_user_id) === String(userId)).map((s) => s.role_label));

  const rows = [];
  let row = new ActionRowBuilder();
  for (const r of byGroup.get(flight).slice(0, 25)) {
    if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
    const occ = byRole.get(r.label) || [];
    const isMine = myLabels.has(r.label);
    const full = r.limit && occ.length >= r.limit && !isMine;
    const btn = new ButtonBuilder()
      .setCustomId(`rr:${p.readyroom_event_id}:s:${r.idx}`)
      .setLabel(`${slotDisplay(r.label, flight)} (${occ.length}${r.limit ? `/${r.limit}` : ''})${isMine ? ' ✓' : ''}`.slice(0, 80))
      .setStyle(isMine ? ButtonStyle.Success : full ? ButtonStyle.Secondary : ButtonStyle.Primary);
    if (full && !isMine) btn.setDisabled(true);
    row.components.push(btn);
  }
  if (row.components.length) rows.push(row);
  const tasking = (p.taskings || {})[flight];
  const locked = byGroup.get(flight).filter((r) => r.qual).map((r) => `🔒 ${slotDisplay(r.label, flight)} needs ${r.qual}`);
  let content = `**${tasking ? `${tasking} — ` : ''}${flight}** — tap a slot to take or leave it.`;
  if (locked.length) content += `\n${locked.join('\n')}`;
  return { content, components: rows };
}

// ---- bot -> ReadyRoom forwarding ----------------------------------------
const ENV_URL = process.env.READYROOM_INGEST_URL || null;
function readyroomUrl(guildId) {
  try { const c = getConfig(guildId); if (c?.readyroom_ingest_url) return c.readyroom_ingest_url; } catch { /* fall through */ }
  return ENV_URL;
}
async function callReadyroom(guildId, body) {
  const url = readyroomUrl(guildId);
  if (!url) return { ok: false, error: 'no_readyroom_url' };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Edit the main panel message (referenced by its stored ids in the panel) — used
// after an ephemeral slot pick, where the interaction is on the picker, not the
// main message.
async function rerenderMain(client, panel) {
  if (!panel?.discord_channel_id || !panel?.discord_message_id) return;
  const ch = client.channels.cache.get(panel.discord_channel_id)
    || (await client.channels.fetch(panel.discord_channel_id).catch(() => null));
  if (!ch?.isTextBased()) return;
  const msg = await ch.messages.fetch(panel.discord_message_id).catch(() => null);
  if (msg) await msg.edit(buildReadyroomPanel(panel)).catch(() => {});
}

// ---- interaction handler ------------------------------------------------
export async function handleReadyroomEventButton(interaction) {
  const m = interaction.customId.match(/^rr:(\d+):(f|s|wd)(?::(\d+))?$/);
  if (!m) return interaction.reply({ content: 'Unrecognized button.', flags: MessageFlags.Ephemeral });
  const [, eid, kind, idx] = m;
  const base = {
    type: 'event_signup', readyroom_event_id: Number(eid),
    discord_user_id: interaction.user.id, username: interaction.user.username,
  };

  // FLIGHT button -> open an ephemeral slot picker (no change to the roster).
  if (kind === 'f') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const resp = await callReadyroom(interaction.guildId, { ...base, action: 'fetch' });
    if (!resp.ok || !resp.panel) return interaction.editReply({ content: 'Couldn’t load that flight from ReadyRoom.' }).catch(() => {});
    const picker = buildSlotPicker(resp.panel, Number(idx), interaction.user.id);
    if (!picker) return interaction.editReply({ content: 'That flight no longer exists.' }).catch(() => {});
    return interaction.editReply(picker).catch(() => {});
  }

  // SLOT or WITHDRAW -> mutate, then re-render. deferUpdate keeps Discord's 3s
  // deadline across the cross-region hop to ReadyRoom.
  await interaction.deferUpdate().catch(() => {});
  const resp = kind === 'wd'
    ? await callReadyroom(interaction.guildId, { ...base, action: 'withdraw' })
    : await callReadyroom(interaction.guildId, { ...base, action: 'toggle', role_index: Number(idx) });

  if (resp.error === 'qual_required') {
    return interaction.followUp({ content: `🔒 That slot requires the **${resp.qual}** qualification.`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (resp.error === 'slot_full') {
    return interaction.followUp({ content: 'That slot is full.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (!resp.ok || !resp.panel) {
    return interaction.followUp({ content: 'Couldn’t reach ReadyRoom to record that — try the site.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (kind === 'wd') {
    // Withdraw is on the main message — editReply edits it in place.
    return interaction.editReply(buildReadyroomPanel(resp.panel)).catch(() => {});
  }
  // Slot button lives on the ephemeral picker: confirm there, re-render the main
  // panel by its stored id.
  const role = (resp.panel.roles || [])[Number(idx)];
  const stillIn = (resp.panel.signups || []).some(
    (s) => String(s.discord_user_id) === String(interaction.user.id) && s.role_label === role?.label);
  const where = role ? slotDisplay(role.label, role.group) : 'that slot';
  await interaction.editReply({ content: stillIn ? `✅ You're in **${where}** (${role?.group}).` : `Left **${where}**.`, embeds: [], components: [] }).catch(() => {});
  await rerenderMain(interaction.client, resp.panel).catch(() => {});
}
