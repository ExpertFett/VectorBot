import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { getVerification, setVerification } from '../db/index.js';

export function buildVerifyMessage(cfg) {
  const embed = new EmbedBuilder().setColor(0x23a55a)
    .setTitle(cfg.title || 'Verify')
    .setDescription(cfg.description || 'Click the button below to verify.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify:grant').setLabel(cfg.button_label || 'Verify').setStyle(ButtonStyle.Success).setEmoji('✅')
  );
  return { embeds: [embed], components: [row] };
}

export async function postVerifyPanel(client, guildId) {
  const cfg = getVerification(guildId);
  if (!cfg.channel_id) throw new Error('no_channel');
  const channel = client.channels.cache.get(cfg.channel_id)
    || (await client.channels.fetch(cfg.channel_id).catch(() => null));
  if (!channel?.isTextBased()) throw new Error('invalid_channel');

  const payload = buildVerifyMessage(cfg);
  if (cfg.message_id) {
    const existing = await channel.messages.fetch(cfg.message_id).catch(() => null);
    if (existing) { await existing.edit(payload); return existing.id; }
  }
  const sent = await channel.send(payload);
  setVerification(guildId, { message_id: sent.id });
  return sent.id;
}

export async function handleVerify(interaction) {
  const cfg = getVerification(interaction.guild.id);
  if (!cfg.enabled || !cfg.role_id) {
    return interaction.reply({ content: 'Verification isn’t set up.', flags: MessageFlags.Ephemeral });
  }
  const role = interaction.guild.roles.cache.get(cfg.role_id);
  if (!role) return interaction.reply({ content: 'The verification role no longer exists.', flags: MessageFlags.Ephemeral });

  const me = interaction.guild.members.me;
  if (me && role.position >= me.roles.highest.position) {
    return interaction.reply({ content: 'I can’t assign the verification role — my role needs to be above it.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.member.roles.cache.has(role.id)) {
    return interaction.reply({ content: 'You’re already verified. ✅', flags: MessageFlags.Ephemeral });
  }
  try {
    await interaction.member.roles.add(role.id, 'Verification');
    await interaction.reply({ content: 'You’re verified — welcome! ✅', flags: MessageFlags.Ephemeral });
  } catch {
    await interaction.reply({ content: 'Failed to verify you. Let an admin know.', flags: MessageFlags.Ephemeral });
  }
}
