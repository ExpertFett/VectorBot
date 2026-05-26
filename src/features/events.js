import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  getEvent, getSignups, setSignup, removeSignup, getSignup, countRoleSignups,
  setEventMessage, getPersonalization,
} from '../db/index.js';

const MAX_ROLES = 20; // leave room for the Withdraw button (Discord max 25 components)
const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

export function buildEventMessage(event, signups = []) {
  const accent = getPersonalization(event.guild_id).embed_color ?? 0x5865f2;
  const cancelled = event.status === 'cancelled';
  const ts = Math.floor(event.start_at / 1000);

  const embed = new EmbedBuilder()
    .setColor(cancelled ? 0xf23f43 : accent)
    .setTitle(`${cancelled ? '[CANCELLED] ' : ''}${event.title}`)
    .setDescription(event.description || null);

  const meta = [];
  if (event.mission) meta.push({ name: 'Mission', value: event.mission, inline: true });
  if (event.map) meta.push({ name: 'Map', value: event.map, inline: true });
  meta.push({ name: 'When', value: `<t:${ts}:F>\n<t:${ts}:R>`, inline: false });
  embed.addFields(meta);

  const byRole = new Map();
  for (const s of signups) {
    if (!byRole.has(s.role_label)) byRole.set(s.role_label, []);
    byRole.get(s.role_label).push(s.user_id);
  }

  const roles = (event.roles || []).slice(0, MAX_ROLES);
  for (const role of roles) {
    const ids = byRole.get(role.label) || [];
    const cap = role.limit ? `/${role.limit}` : '';
    const list = ids.length ? ids.map((id) => `<@${id}>`).join('\n').slice(0, 1024) : '—';
    embed.addFields({ name: `${role.emoji ? role.emoji + ' ' : ''}${role.label} (${ids.length}${cap})`, value: list, inline: true });
  }
  if (isHttpUrl(event.image)) embed.setImage(event.image);
  embed.setFooter({ text: `Event #${event.id}` });

  if (cancelled) return { embeds: [embed], components: [] };

  const rows = [];
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

export async function handleEventButton(interaction) {
  const [, idStr, action, idxStr] = interaction.customId.split(':');
  const event = getEvent(Number(idStr));
  if (!event || event.status !== 'scheduled') {
    return interaction.reply({ content: 'This event is no longer open.', flags: MessageFlags.Ephemeral });
  }

  if (action === 'withdraw') {
    const removed = removeSignup(event.id, interaction.user.id);
    await rerender(interaction, event.id);
    return interaction.reply({ content: removed ? 'You’ve withdrawn from this event.' : 'You weren’t signed up.', flags: MessageFlags.Ephemeral });
  }

  const role = event.roles[Number(idxStr)];
  if (!role) return interaction.reply({ content: 'That slot no longer exists.', flags: MessageFlags.Ephemeral });

  const existing = getSignup(event.id, interaction.user.id);
  if (existing?.role_label === role.label) {
    removeSignup(event.id, interaction.user.id);
    await rerender(interaction, event.id);
    return interaction.reply({ content: `Removed you from **${role.label}**.`, flags: MessageFlags.Ephemeral });
  }
  if (role.limit && countRoleSignups(event.id, role.label) >= role.limit) {
    return interaction.reply({ content: `**${role.label}** is full.`, flags: MessageFlags.Ephemeral });
  }
  setSignup(event.id, interaction.user.id, role.label);
  await rerender(interaction, event.id);
  return interaction.reply({ content: `You’re signed up as **${role.label}**.`, flags: MessageFlags.Ephemeral });
}
