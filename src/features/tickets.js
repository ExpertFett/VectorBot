import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ChannelType, PermissionFlagsBits, MessageFlags,
} from 'discord.js';
import {
  getTicketsConfig, setTicketsConfig, createTicket,
  getOpenTicketByOpener, getTicketByChannel, closeTicket, claimTicket, getPersonalization,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';

// Ticket control buttons (claim / close / delete).
function ticketControls({ claimed = false, closed = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel(claimed ? 'Claimed' : 'Claim').setStyle(ButtonStyle.Success).setEmoji('🙋').setDisabled(claimed),
    new ButtonBuilder().setCustomId('ticket:close').setLabel(closed ? 'Closed' : 'Close').setStyle(ButtonStyle.Secondary).setEmoji('🔒').setDisabled(closed),
    new ButtonBuilder().setCustomId('ticket:delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
  );
}

// Staff = has the support role or Manage Channels.
function isStaff(interaction, cfg) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  return !!(cfg.support_role_id && interaction.member?.roles.cache.has(cfg.support_role_id));
}

export function buildPanelMessage(cfg, accent = 0x9119f5) {
  const embed = (cfg.embed && buildEmbed(cfg.embed, undefined, accent)) || new EmbedBuilder().setColor(accent)
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

  const accent = getPersonalization(guildId).embed_color ?? 0x9119f5;
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

    // Fire any 'ticket.opened' automations.
    const { fireTrigger } = await import('../automations/engine.js');
    fireTrigger('ticket.opened', {
      guild, member: interaction.member, user: interaction.user, channel,
    }, interaction.client).catch(() => {});

    const mention = cfg.support_role_id ? `<@&${cfg.support_role_id}> ` : '';
    const accent = getPersonalization(guild.id).embed_color ?? 0x9119f5;
    await channel.send({
      content: `${interaction.user} ${mention}`.trim(),
      embeds: [new EmbedBuilder().setColor(accent).setDescription(cfg.open_message)],
      components: [ticketControls()],
    });
    await interaction.editReply(`Ticket created: ${channel}`);
  } catch (err) {
    console.error('Ticket create failed:', err.message);
    await interaction.editReply('Failed to create your ticket — I’m likely missing the **Manage Channels** permission.');
  }
}

export async function handleClaimTicket(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ content: 'This isn’t a ticket channel.', flags: MessageFlags.Ephemeral });
  const cfg = getTicketsConfig(interaction.guild.id);
  if (!isStaff(interaction, cfg)) return interaction.reply({ content: 'Only staff can claim tickets.', flags: MessageFlags.Ephemeral });
  if (ticket.claimed_by) return interaction.reply({ content: `Already claimed by <@${ticket.claimed_by}>.`, flags: MessageFlags.Ephemeral });

  claimTicket(interaction.channelId, interaction.user.id);
  await interaction.update({ components: [ticketControls({ claimed: true })] }).catch(() => {});
  await interaction.followUp({ content: `🙋 Ticket claimed by ${interaction.user}.` }).catch(() => {});
}

export async function handleCloseTicket(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ content: 'This isn’t a ticket channel.', flags: MessageFlags.Ephemeral });

  closeTicket(interaction.channelId);
  // Lock it: the opener can no longer send. Channel stays for the record until deleted.
  await interaction.channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: false }).catch(() => {});
  await interaction.update({ components: [ticketControls({ claimed: !!ticket.claimed_by, closed: true })] }).catch(() => {});
  await interaction.followUp({ content: `🔒 Ticket closed by ${interaction.user}. Staff can **Delete** it when done.` }).catch(() => {});

  // Fire any 'ticket.closed' automations.
  const { fireTrigger } = await import('../automations/engine.js');
  fireTrigger('ticket.closed', {
    guild: interaction.guild, member: interaction.member, user: interaction.user, channel: interaction.channel,
  }, interaction.client).catch(() => {});
}

export async function handleDeleteTicket(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ content: 'This isn’t a ticket channel.', flags: MessageFlags.Ephemeral });
  const cfg = getTicketsConfig(interaction.guild.id);
  if (!isStaff(interaction, cfg)) return interaction.reply({ content: 'Only staff can delete tickets.', flags: MessageFlags.Ephemeral });

  closeTicket(interaction.channelId);
  await interaction.reply({ content: `🗑️ Deleting this ticket in 5 seconds (by ${interaction.user.username})…` });
  setTimeout(() => interaction.channel?.delete('Ticket deleted').catch(() => {}), 5000);
}
