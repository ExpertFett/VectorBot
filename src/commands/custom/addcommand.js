import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { setCustomCommand } from '../../db/index.js';

const PREFIX = process.env.COMMAND_PREFIX || '!';
const NAME_RE = /^[a-z0-9_-]{1,32}$/;

export default {
  data: new SlashCommandBuilder()
    .setName('addcommand')
    .setDescription(`Create or update a custom ${PREFIX}command.`)
    .addStringOption((o) => o.setName('name').setDescription('Command name (letters, numbers, - or _)').setRequired(true))
    .addStringOption((o) => o.setName('response').setDescription('What the bot replies with').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const name = interaction.options.getString('name').toLowerCase().replace(/^[/!]+/, '');
    const response = interaction.options.getString('response');

    if (!NAME_RE.test(name)) {
      return interaction.reply({
        content: 'Invalid name. Use 1-32 characters: letters, numbers, `-` or `_` (no spaces).',
        flags: MessageFlags.Ephemeral,
      });
    }

    setCustomCommand(interaction.guild.id, name, response, interaction.user.id);
    await interaction.reply({ content: `Saved. Trigger it with \`${PREFIX}${name}\`.`, flags: MessageFlags.Ephemeral });
  },
};
