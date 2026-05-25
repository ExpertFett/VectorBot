import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { addModLog } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server.')
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban'))
    .addIntegerOption((o) =>
      o.setName('delete_days')
        .setDescription('Days of their recent messages to delete (0-7)')
        .setMinValue(0)
        .setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

    if (user.id === interaction.user.id) {
      return interaction.reply({ content: "You can't ban yourself.", flags: MessageFlags.Ephemeral });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !member.bannable) {
      return interaction.reply({
        content: "I can't ban that user — their role is higher than mine, or I lack permission.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await interaction.guild.bans.create(user.id, {
        reason: `${reason} — by ${interaction.user.tag}`,
        deleteMessageSeconds: deleteDays * 86400,
      });
      addModLog({
        guildId: interaction.guild.id, action: 'ban',
        targetId: user.id, targetTag: user.tag,
        moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason,
      });
      await interaction.reply(`Banned **${user.tag}**. Reason: ${reason}`);
    } catch (err) {
      console.error('Ban failed:', err);
      await interaction.reply({ content: 'Failed to ban that user.', flags: MessageFlags.Ephemeral });
    }
  },
};
