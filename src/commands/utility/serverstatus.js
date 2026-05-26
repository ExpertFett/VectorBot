import { SlashCommandBuilder } from 'discord.js';
import { buildStatusEmbed } from '../../features/serverStatus.js';

export default {
  data: new SlashCommandBuilder().setName('serverstatus').setDescription('Show the current DCS server status.'),

  async execute(interaction) {
    await interaction.reply({ embeds: [buildStatusEmbed(interaction.guild.id)] });
  },
};
