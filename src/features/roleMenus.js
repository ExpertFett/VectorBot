import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { setRoleMenuMessage } from '../db/index.js';

const STYLE_MAP = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger,
};

export function buildMenuMessage(menu) {
  const embed = new EmbedBuilder().setColor(0x5865f2);
  if (menu.title) embed.setTitle(menu.title);
  embed.setDescription(menu.description || 'Click a button to toggle a role.');

  const rows = [];
  const buttons = (menu.buttons || []).filter((b) => b.role_id).slice(0, 25);
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const b of buttons.slice(i, i + 5)) {
      const btn = new ButtonBuilder()
        .setCustomId(`rolemenu:${menu.id}:${b.role_id}`)
        .setLabel(b.label || 'Role')
        .setStyle(STYLE_MAP[b.style] || ButtonStyle.Secondary);
      if (b.emoji) { try { btn.setEmoji(b.emoji); } catch { /* invalid emoji */ } }
      row.addComponents(btn);
    }
    rows.push(row);
  }
  return { embeds: [embed], components: rows };
}

export async function postRoleMenu(client, menu) {
  const channel =
    client.channels.cache.get(menu.channel_id) ||
    (await client.channels.fetch(menu.channel_id).catch(() => null));
  if (!channel?.isTextBased()) throw new Error('invalid_channel');

  const payload = buildMenuMessage(menu);

  if (menu.message_id) {
    const existing = await channel.messages.fetch(menu.message_id).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      setRoleMenuMessage(menu.id, channel.id, existing.id);
      return existing.id;
    }
  }
  const sent = await channel.send(payload);
  setRoleMenuMessage(menu.id, channel.id, sent.id);
  return sent.id;
}

export async function handleRoleButton(interaction) {
  const [, , roleId] = interaction.customId.split(':');
  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.reply({ content: 'That role no longer exists.', flags: MessageFlags.Ephemeral });
  }

  const me = interaction.guild.members.me;
  if (me && role.position >= me.roles.highest.position) {
    return interaction.reply({
      content: `I can’t manage **${role.name}** — my role needs to be above it.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = interaction.member;
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Role menu');
      await interaction.reply({ content: `Removed **${role.name}**.`, flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(roleId, 'Role menu');
      await interaction.reply({ content: `Added **${role.name}**.`, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error('Role button error:', err.message);
    await interaction.reply({ content: 'Failed to update your roles.', flags: MessageFlags.Ephemeral });
  }
}
