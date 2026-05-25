import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';

const PREFIX = process.env.COMMAND_PREFIX || '!';

export default {
  data: new SlashCommandBuilder().setName('help').setDescription('List the bot\'s commands.'),

  async execute(interaction, client) {
    const lines = [...client.commands.values()]
      .sort((a, b) => a.data.name.localeCompare(b.data.name))
      .map((c) => `\`/${c.data.name}\` — ${c.data.description}`);

    const embed = new EmbedBuilder()
      .setTitle('Commands')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Custom text commands are triggered with "${PREFIX}". See /commands.` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
