import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getMusic } from '../../features/music.js';

export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song.'),

  async execute(interaction) {
    const distube = getMusic();
    const queue = distube?.getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    if (queue.songs.length <= 1) {
      // Last song — skip is effectively stop. Tell the user so it doesn't feel silent.
      try { await distube.stop(interaction.guild.id); }
      catch { /* already stopped */ }
      return interaction.reply({ content: '⏭️ Skipped — that was the last song in the queue.' });
    }
    try {
      await distube.skip(interaction.guild.id);
      await interaction.reply({ content: `⏭️ Skipped by ${interaction.user}.` });
    } catch (err) {
      await interaction.reply({ content: `Couldn't skip: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  },
};
