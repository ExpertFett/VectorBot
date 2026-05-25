import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { addWarning, getWarnings } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member and record it.')
    .addUserOption((o) => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the warning').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    if (user.bot) {
      return interaction.reply({ content: "You can't warn a bot.", flags: MessageFlags.Ephemeral });
    }

    addWarning(interaction.guild.id, user.id, interaction.user.id, reason);
    const total = getWarnings(interaction.guild.id, user.id).length;

    await user.send(`You were warned in **${interaction.guild.name}**: ${reason}`).catch(() => {});
    await interaction.reply(`Warned **${user.tag}** (warning #${total}). Reason: ${reason}`);
  },
};
