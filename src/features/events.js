import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import {
  getEvent, getSignups, getUserSignups, setSignup, removeUserRole, removeAllUserSignups,
  countRoleSignups, setEventMessage, getPersonalization,
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
  const ts = Math.floor(event.start_at / 1000);

  let embed = event.embed ? buildEmbed(event.embed, undefined, accent) : null;
  if (embed) {
    if (!embed.data.title) embed.setTitle(event.title);
    if (cancelled) { embed.setColor(0xf23f43); embed.setTitle(`[CANCELLED] ${embed.data.title}`); }
  } else {
    embed = new EmbedBuilder()
      .setColor(cancelled ? 0xf23f43 : accent)
      .setTitle(`${cancelled ? '[CANCELLED] ' : ''}${event.title}`)
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
  if (roles.length <= BUTTON_LIMIT) {
    for (const role of roles) {
      const { active, waiting, cap } = split(role);
      let val = active.length ? active.map((id) => `<@${id}>`).join('\n') : '—';
      if (waiting.length) val += `\n*WL:* ${mention(waiting)}`;
      embed.addFields({ name: `${role.emoji ? role.emoji + ' ' : ''}${role.label} (${active.length}${cap})`, value: val.slice(0, 1024), inline: true });
    }
  } else {
    for (const grp of groupRoles(roles).slice(0, 22)) {
      const lines = grp.items.map(({ role }) => {
        const { active, waiting, cap } = split(role);
        let line = `**${role.label}** (${active.length}${cap}): ${mention(active)}`;
        if (waiting.length) line += ` *(WL: ${waiting.length})*`;
        return line;
      });
      embed.addFields({ name: grp.name || 'Slots', value: lines.join('\n').slice(0, 1024) });
    }
  }

  if (!event.embed && isHttpUrl(event.image)) embed.setImage(event.image);
  const flags = [event.multi_signup ? 'multi-slot' : '1 slot/person', event.waitlist ? 'waitlist on' : null].filter(Boolean).join(' · ');
  embed.setFooter({ text: `Event #${event.id} · ${flags}` });

  if (cancelled) return { embeds: [embed], components: [] };

  const rows = [];
  if (roles.length <= BUTTON_LIMIT) {
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
    for (let chunk = 0; chunk < 4 && chunk * 25 < roles.length; chunk++) {
      const start = chunk * 25;
      const slice = roles.slice(start, start + 25);
      const select = new StringSelectMenuBuilder()
        .setCustomId(`event:${event.id}:sel:${chunk}`)
        .setPlaceholder(`Sign up — slots ${start + 1}-${start + slice.length}`)
        .setMinValues(0).setMaxValues(1)
        .addOptions(slice.map((role, j) => {
          const { active, cap } = split(role);
          const opt = { label: role.label.slice(0, 100), value: String(start + j), description: `${role.group ? role.group + ' · ' : ''}${active.length}${cap} signed`.slice(0, 100) };
          if (role.emoji) opt.emoji = role.emoji;
          return opt;
        }));
      rows.push(new ActionRowBuilder().addComponents(select));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event:${event.id}:withdraw`).setLabel('Withdraw').setStyle(ButtonStyle.Secondary).setEmoji('🚫')
    ));
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

function claim(event, userId, role) {
  const mine = getUserSignups(event.id, userId).map((s) => s.role_label);
  if (mine.includes(role.label)) {
    removeUserRole(event.id, userId, role.label);
    return { changed: true, msg: `Removed you from **${role.label}**.` };
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
  const role = event.roles[Number(idxStr)];
  if (!role) return interaction.reply({ content: 'That slot no longer exists.', flags: MessageFlags.Ephemeral });
  let result;
  await withPromotion(interaction.client, event, () => { result = claim(event, interaction.user.id, role); });
  if (result.changed) await rerender(interaction, event.id);
  return interaction.reply({ content: result.msg, flags: MessageFlags.Ephemeral });
}

export async function handleEventSelect(interaction) {
  const [, idStr] = interaction.customId.split(':');
  const event = getEvent(Number(idStr));
  if (!event || event.status !== 'scheduled') {
    return interaction.reply({ content: 'This event is no longer open.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.values.length === 0) {
    return interaction.reply({ content: 'Use the Withdraw button to leave.', flags: MessageFlags.Ephemeral });
  }
  const role = event.roles[Number(interaction.values[0])];
  if (!role) return interaction.reply({ content: 'That slot no longer exists.', flags: MessageFlags.Ephemeral });
  let result;
  await withPromotion(interaction.client, event, () => { result = claim(event, interaction.user.id, role); });
  if (result.changed) await rerender(interaction, event.id);
  return interaction.reply({ content: result.msg, flags: MessageFlags.Ephemeral });
}
