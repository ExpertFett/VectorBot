import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getMusic } from '../../features/music.js';

export default {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume a paused song.'),

  async execute(interaction) {
    const distube = getMusic();
    const queue = distube?.getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    if (!queue.paused) return interaction.reply({ content: 'Already playing.', flags: MessageFlags.Ephemeral });
    try {
      distube.resume(interaction.guild.id);
      await interaction.reply({ content: `▶️ Resumed by ${interaction.user}.` });
    } catch (err) {
      await interaction.reply({ content: `Couldn't resume: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  },
};
