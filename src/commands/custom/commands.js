import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { listCustomCommands } from '../../db/index.js';

const PREFIX = process.env.COMMAND_PREFIX || '!';

export default {
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('List all custom commands on this server.'),

  async execute(interaction) {
    const names = listCustomCommands(interaction.guild.id);
    if (names.length === 0) {
      return interaction.reply({ content: 'No custom commands yet. Add one with `/addcommand`.', flags: MessageFlags.Ephemeral });
    }
    const list = names.map((n) => `\`${PREFIX}${n}\``).join(', ');
    await interaction.reply({ content: `**Custom commands (${names.length}):**\n${list}`, flags: MessageFlags.Ephemeral });
  },
};
