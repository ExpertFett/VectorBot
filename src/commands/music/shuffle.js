import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getMusic } from '../../features/music.js';

export default {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the upcoming queue (keeps the current song playing).'),

  async execute(interaction) {
    const distube = getMusic();
    const queue = distube?.getQueue(interaction.guild.id);
    if (!queue || queue.songs.length <= 2) {
      return interaction.reply({ content: 'Need at least 2 songs in the queue to shuffle.', flags: MessageFlags.Ephemeral });
    }
    try {
      queue.shuffle();
      await interaction.reply({ content: `🔀 Shuffled ${queue.songs.length - 1} upcoming songs.` });
    } catch (err) {
      await interaction.reply({ content: `Couldn't shuffle: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  },
};
