import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { clearWarnings } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Clear all warnings for a member.')
    .addUserOption((o) => o.setName('user').setDescription('User to clear').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const removed = clearWarnings(interaction.guild.id, user.id);

    if (removed === 0) {
      return interaction.reply({ content: `**${user.tag}** had no warnings to clear.`, flags: MessageFlags.Ephemeral });
    }
    await interaction.reply(`Cleared **${removed}** warning(s) for **${user.tag}**.`);
  },
};
