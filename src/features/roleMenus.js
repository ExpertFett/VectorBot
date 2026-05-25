import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { setRoleMenuMessage, getRoleMenu } from '../db/index.js';
import { buildEmbed } from '../util/embed.js';

const STYLE_MAP = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger,
};

export function buildMenuMessage(menu) {
  let embed = menu.embed ? buildEmbed(menu.embed) : null;
  if (!embed) {
    embed = new EmbedBuilder().setColor(0x5865f2);
    if (menu.title) embed.setTitle(menu.title);
    embed.setDescription(menu.description || 'Pick a role below.');
  }

  const entries = (menu.buttons || []).filter((b) => b.role_id).slice(0, 25);

  if (menu.type === 'dropdown') {
    if (entries.length === 0) return { embeds: [embed], components: [] };
    const options = entries.map((b) => {
      const o = { label: (b.label || 'Role').slice(0, 100), value: b.role_id };
      if (b.emoji) o.emoji = b.emoji;
      return o;
    });
    const maxValues = Math.min(Math.max(menu.max_values || 1, 1), options.length);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rolemenu:${menu.id}`)
      .setPlaceholder('Select your roles')
      .setMinValues(0)
      .setMaxValues(maxValues)
      .addOptions(options);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
  }

  const rows = [];
  for (let i = 0; i < entries.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const b of entries.slice(i, i + 5)) {
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

// Dropdown (string select) role menu: selected options become the member's set
// among this menu's roles; unselected ones are removed.
export async function handleRoleSelect(interaction) {
  const menu = getRoleMenu(Number(interaction.customId.split(':')[1]));
  if (!menu) return interaction.reply({ content: 'This menu no longer exists.', flags: MessageFlags.Ephemeral });

  const menuRoleIds = (menu.buttons || []).map((b) => b.role_id).filter(Boolean);
  const selected = new Set(interaction.values);
  const me = interaction.guild.members.me;
  const member = interaction.member;
  const changes = [];

  for (const roleId of menuRoleIds) {
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role || (me && role.position >= me.roles.highest.position)) continue;
    const has = member.roles.cache.has(roleId);
    try {
      if (selected.has(roleId) && !has) { await member.roles.add(roleId, 'Role menu'); changes.push(`+${role.name}`); }
      else if (!selected.has(roleId) && has) { await member.roles.remove(roleId, 'Role menu'); changes.push(`−${role.name}`); }
    } catch { /* hierarchy/permission */ }
  }
  await interaction.reply({ content: changes.length ? `Updated: ${changes.join(', ')}` : 'No changes.', flags: MessageFlags.Ephemeral });
}
