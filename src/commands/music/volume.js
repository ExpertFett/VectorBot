import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getMusic } from '../../features/music.js';

export default {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the music volume (0-150%).')
    .addIntegerOption((o) =>
      o.setName('percent').setDescription('Volume 0-150').setRequired(true).setMinValue(0).setMaxValue(150)),

  async execute(interaction) {
    const distube = getMusic();
    const queue = distube?.getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    const vol = interaction.options.getInteger('percent', true);
    try {
      distube.setVolume(interaction.guild.id, vol);
      await interaction.reply({ content: `🔊 Volume set to **${vol}%** by ${interaction.user}.` });
    } catch (err) {
      await interaction.reply({ content: `Couldn't set volume: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  },
};
