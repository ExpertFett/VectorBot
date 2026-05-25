import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { removeCustomCommand } from '../../db/index.js';

const PREFIX = process.env.COMMAND_PREFIX || '!';

export default {
  data: new SlashCommandBuilder()
    .setName('removecommand')
    .setDescription(`Delete a custom ${PREFIX}command.`)
    .addStringOption((o) => o.setName('name').setDescription('Command name to delete').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const name = interaction.options.getString('name').toLowerCase().replace(/^[/!]+/, '');
    const removed = removeCustomCommand(interaction.guild.id, name);

    if (removed === 0) {
      return interaction.reply({ content: `No custom command named \`${name}\`.`, flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({ content: `Deleted \`${PREFIX}${name}\`.`, flags: MessageFlags.Ephemeral });
  },
};
