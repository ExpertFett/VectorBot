import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ChannelType, PermissionFlagsBits, MessageFlags,
} from 'discord.js';
import {
  getTicketsConfig, setTicketsConfig, createTicket,
  getOpenTicketByOpener, getTicketByChannel, closeTicket, getPersonalization,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';

export function buildPanelMessage(cfg, accent = 0x5865f2) {
  const embed = (cfg.embed && buildEmbed(cfg.embed)) || new EmbedBuilder().setColor(accent)
    .setTitle(cfg.title || 'Support')
    .setDescription(cfg.description || 'Open a ticket.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:open').setLabel(cfg.button_label || 'Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
  );
  return { embeds: [embed], components: [row] };
}

export async function postTicketPanel(client, guildId) {
  const cfg = getTicketsConfig(guildId);
  if (!cfg.panel_channel_id) throw new Error('no_channel');
  const channel = client.channels.cache.get(cfg.panel_channel_id)
    || (await client.channels.fetch(cfg.panel_channel_id).catch(() => null));
  if (!channel?.isTextBased()) throw new Error('invalid_channel');

  const accent = getPersonalization(guildId).embed_color ?? 0x5865f2;
  const payload = buildPanelMessage(cfg, accent);
  if (cfg.panel_message_id) {
    const existing = await channel.messages.fetch(cfg.panel_message_id).catch(() => null);
    if (existing) { await existing.edit(payload); return existing.id; }
  }
  const sent = await channel.send(payload);
  setTicketsConfig(guildId, { panel_channel_id: channel.id, panel_message_id: sent.id });
  return sent.id;
}

export async function handleOpenTicket(interaction) {
  const cfg = getTicketsConfig(interaction.guild.id);
  if (!cfg.enabled) return interaction.reply({ content: 'Tickets are currently disabled.', flags: MessageFlags.Ephemeral });

  const existing = getOpenTicketByOpener(interaction.guild.id, interaction.user.id);
  if (existing) {
    return interaction.reply({ content: `You already have an open ticket: <#${existing.channel_id}>`, flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ];
  if (cfg.support_role_id) {
    overwrites.push({ id: cfg.support_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  try {
    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
      type: ChannelType.GuildText,
      parent: cfg.category_id || undefined,
      permissionOverwrites: overwrites,
    });
    createTicket(guild.id, channel.id, interaction.user.id);

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );
    const mention = cfg.support_role_id ? `<@&${cfg.support_role_id}> ` : '';
    const accent = getPersonalization(guild.id).embed_color ?? 0x5865f2;
    await channel.send({
      content: `${interaction.user} ${mention}`.trim(),
      embeds: [new EmbedBuilder().setColor(accent).setDescription(cfg.open_message)],
      components: [closeRow],
    });
    await interaction.editReply(`Ticket created: ${channel}`);
  } catch (err) {
    console.error('Ticket create failed:', err.message);
    await interaction.editReply('Failed to create your ticket — I’m likely missing the **Manage Channels** permission.');
  }
}

export async function handleCloseTicket(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ content: 'This isn’t a ticket channel.', flags: MessageFlags.Ephemeral });
  closeTicket(interaction.channelId);
  await interaction.reply({ content: 'Closing this ticket in 5 seconds…' });
  setTimeout(() => interaction.channel?.delete('Ticket closed').catch(() => {}), 5000);
}
