import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getMusic } from '../../features/music.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and leave the voice channel.'),

  async execute(interaction) {
    const distube = getMusic();
    const queue = distube?.getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    try {
      await distube.stop(interaction.guild.id);
      await interaction.reply({ content: `⏹️ Stopped by ${interaction.user} — queue cleared.` });
    } catch (err) {
      await interaction.reply({ content: `Couldn't stop: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  },
};
