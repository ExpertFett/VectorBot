import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import {
  getEvent, getSignups, setSignup, removeSignup, getSignup, countRoleSignups,
  setEventMessage, getPersonalization,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';

const BUTTON_LIMIT = 20; // up to 20 roles render as buttons; beyond that we paginate selects
const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

// Group roles (preserving global index) by their `group` field.
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

  // Header: custom embed template, or a default one.
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
  const fill = (role) => {
    const ids = byRole.get(role.label) || [];
    return { ids, cap: role.limit ? `/${role.limit}` : '' };
  };

  const roles = event.roles || [];

  // Roster display.
  if (roles.length <= BUTTON_LIMIT) {
    for (const role of roles) {
      const { ids, cap } = fill(role);
      embed.addFields({
        name: `${role.emoji ? role.emoji + ' ' : ''}${role.label} (${ids.length}${cap})`,
        value: ids.length ? ids.map((id) => `<@${id}>`).join('\n').slice(0, 1024) : '—',
        inline: true,
      });
    }
  } else {
    // Grouped, compact: one field per flight/group.
    for (const grp of groupRoles(roles).slice(0, 22)) {
      const lines = grp.items.map(({ role }) => {
        const { ids, cap } = fill(role);
        const who = ids.length ? ids.map((id) => `<@${id}>`).join(', ') : '—';
        return `**${role.label}** (${ids.length}${cap}): ${who}`;
      });
      embed.addFields({ name: grp.name || 'Slots', value: lines.join('\n').slice(0, 1024) });
    }
  }

  if (!event.embed && isHttpUrl(event.image)) embed.setImage(event.image);
  embed.setFooter({ text: `Event #${event.id}` });

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
    // Paginate into selects of 25 (max 4 selects = 100 slots), preserving group order.
    for (let chunk = 0; chunk < 4 && chunk * 25 < roles.length; chunk++) {
      const start = chunk * 25;
      const slice = roles.slice(start, start + 25);
      const select = new StringSelectMenuBuilder()
        .setCustomId(`event:${event.id}:sel:${chunk}`)
        .setPlaceholder(`Sign up — slots ${start + 1}-${start + slice.length}`)
        .setMinValues(0).setMaxValues(1)
        .addOptions(slice.map((role, j) => {
          const { ids, cap } = fill(role);
          const opt = { label: role.label.slice(0, 100), value: String(start + j), description: `${role.group ? role.group + ' · ' : ''}${ids.length}${cap} signed`.slice(0, 100) };
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

// Claim/move/toggle a role for a user. Returns a status message string.
function claim(event, userId, role) {
  const existing = getSignup(event.id, userId);
  if (existing?.role_label === role.label) {
    removeSignup(event.id, userId);
    return { changed: true, msg: `Removed you from **${role.label}**.` };
  }
  if (role.limit && countRoleSignups(event.id, role.label) >= role.limit) {
    return { changed: false, msg: `**${role.label}** is full.` };
  }
  setSignup(event.id, userId, role.label);
  return { changed: true, msg: `You’re signed up as **${role.label}**.` };
}

export async function handleEventButton(interaction) {
  const [, idStr, action, idxStr] = interaction.customId.split(':');
  const event = getEvent(Number(idStr));
  if (!event || event.status !== 'scheduled') {
    return interaction.reply({ content: 'This event is no longer open.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'withdraw') {
    const removed = removeSignup(event.id, interaction.user.id);
    await rerender(interaction, event.id);
    return interaction.reply({ content: removed ? 'You’ve withdrawn.' : 'You weren’t signed up.', flags: MessageFlags.Ephemeral });
  }
  const role = event.roles[Number(idxStr)];
  if (!role) return interaction.reply({ content: 'That slot no longer exists.', flags: MessageFlags.Ephemeral });
  const { changed, msg } = claim(event, interaction.user.id, role);
  if (changed) await rerender(interaction, event.id);
  return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
}

export async function handleEventSelect(interaction) {
  const [, idStr] = interaction.customId.split(':');
  const event = getEvent(Number(idStr));
  if (!event || event.status !== 'scheduled') {
    return interaction.reply({ content: 'This event is no longer open.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.values.length === 0) {
    const removed = removeSignup(event.id, interaction.user.id);
    await rerender(interaction, event.id);
    return interaction.reply({ content: removed ? 'You’ve withdrawn.' : 'No change.', flags: MessageFlags.Ephemeral });
  }
  const role = event.roles[Number(interaction.values[0])];
  if (!role) return interaction.reply({ content: 'That slot no longer exists.', flags: MessageFlags.Ephemeral });
  const { changed, msg } = claim(event, interaction.user.id, role);
  if (changed) await rerender(interaction, event.id);
  return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
}
