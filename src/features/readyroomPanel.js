// Renders + drives the sign-up panel for events PUBLISHED FROM READYROOM.
//
// Unlike native bot events (src/features/events.js), ReadyRoom is the single
// source of truth here: the bot holds NO sign-up state for these. It renders
// the panel from the payload ReadyRoom sends (publish / edit / click-response)
// and forwards every button click back to ReadyRoom, then re-renders from the
// authoritative panel ReadyRoom returns. That keeps the Discord message and the
// ReadyRoom roster perfectly in sync with no second store to drift.
//
// customId scheme:  rr:<readyroomEventId>:s:<roleIndex>   (take/leave a slot)
//                   rr:<readyroomEventId>:wd              (withdraw from all)

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { getConfig } from '../db/index.js';

const KIND_COLOR = { extra_credit: 0xf0b429, mission: 0x8a63ff };
const DEFAULT_COLOR = 0x4c8bf5;
const SLOT_BUTTON_CAP = 23; // Discord allows 25 components; leave room for Withdraw

// ---- rendering ----------------------------------------------------------
export function buildReadyroomPanel(p) {
  const roles = Array.isArray(p.roles) ? p.roles : [];
  const taskings = p.taskings || {};
  const signups = Array.isArray(p.signups) ? p.signups : [];
  const ts = Number.isFinite(Number(p.start_at)) ? Math.floor(Number(p.start_at) / 1000) : null;

  // group slots by flight, keeping each slot's original index for the customId
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
  const nameOf = (s) => s.callsign || s.display_name || 'pilot';

  const embed = new EmbedBuilder()
    .setColor(KIND_COLOR[p.kind] ?? DEFAULT_COLOR)
    .setTitle(((p.kind === 'extra_credit' ? '⭐ ' : '') + String(p.title || 'Event')).slice(0, 256));
  if (p.url) embed.setURL(String(p.url).slice(0, 500));
  if (p.description) embed.setDescription(String(p.description).slice(0, 1800));
  if (ts) embed.addFields({ name: 'When', value: `<t:${ts}:F> · <t:${ts}:R>`, inline: false });

  // one field per flight: tasking, fill count, and who's in each slot
  for (const flight of flights.slice(0, 24)) {
    const slots = byGroup.get(flight);
    const tasking = taskings[flight];
    const filled = slots.reduce((n, r) => n + (byRole.get(r.label)?.length || 0), 0);
    const cap = slots.reduce((n, r) => n + (r.limit || 0), 0);
    const lines = slots.map((r) => {
      const occ = byRole.get(r.label) || [];
      return `${r.label}${r.qual ? ' 🔒' : ''}: ${occ.length ? occ.map(nameOf).join(', ') : '—'}`;
    });
    const header = `${tasking ? `${tasking} — ` : ''}${flight} (${filled}/${cap})`;
    embed.addFields({ name: header.slice(0, 256), value: (lines.join('\n') || '—').slice(0, 1024), inline: true });
  }
  embed.setFooter({ text: 'Sign up below — synced live with ReadyRoom' });

  if (!roles.length) return { embeds: [embed], components: [] };

  // one button per slot (capped), grouped into rows of 5, plus Withdraw
  const rows = [];
  let row = new ActionRowBuilder();
  let count = 0;
  for (const flight of flights) {
    for (const r of byGroup.get(flight)) {
      if (count >= SLOT_BUTTON_CAP) break;
      if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
      const occ = byRole.get(r.label) || [];
      const full = r.limit && occ.length >= r.limit;
      row.components.push(new ButtonBuilder()
        .setCustomId(`rr:${p.readyroom_event_id}:s:${r.idx}`)
        .setLabel(`${r.label} (${occ.length}${r.limit ? `/${r.limit}` : ''})`.slice(0, 80))
        .setStyle(full ? ButtonStyle.Secondary : ButtonStyle.Primary));
      count++;
    }
  }
  if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
  row.components.push(new ButtonBuilder()
    .setCustomId(`rr:${p.readyroom_event_id}:wd`).setLabel('Withdraw').setStyle(ButtonStyle.Danger).setEmoji('🚫'));
  rows.push(row);
  return { embeds: [embed], components: rows };
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
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---- interaction handler ------------------------------------------------
export async function handleReadyroomEventButton(interaction) {
  const m = interaction.customId.match(/^rr:(\d+):(wd|s)(?::(\d+))?$/);
  if (!m) return interaction.reply({ content: 'Unrecognized button.', flags: MessageFlags.Ephemeral });
  const [, eid, action, idx] = m;

  // Ack immediately — the ReadyRoom round-trip can exceed Discord's 3s deadline
  // (its server is in another region). deferUpdate keeps the message as-is.
  await interaction.deferUpdate().catch(() => {});

  const base = {
    type: 'event_signup', readyroom_event_id: Number(eid),
    discord_user_id: interaction.user.id, username: interaction.user.username,
  };
  const resp = action === 'wd'
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
  // Re-render the panel from the authoritative ReadyRoom state.
  await interaction.editReply(buildReadyroomPanel(resp.panel)).catch(() => {});
}
