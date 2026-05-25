import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption((o) => o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the kick'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (user.id === interaction.user.id) {
      return interaction.reply({ content: "You can't kick yourself.", flags: MessageFlags.Ephemeral });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: 'That user is not in this server.', flags: MessageFlags.Ephemeral });
    }
    if (!member.kickable) {
      return interaction.reply({
        content: "I can't kick that user — their role is higher than mine, or I lack permission.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await member.kick(`${reason} — by ${interaction.user.tag}`);
      await interaction.reply(`Kicked **${user.tag}**. Reason: ${reason}`);
    } catch (err) {
      console.error('Kick failed:', err);
      await interaction.reply({ content: 'Failed to kick that user.', flags: MessageFlags.Ephemeral });
    }
  },
};
