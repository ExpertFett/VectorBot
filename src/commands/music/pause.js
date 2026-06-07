import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getMusic } from '../../features/music.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song.'),

  async execute(interaction) {
    const distube = getMusic();
    const queue = distube?.getQueue(interaction.guild.id);
    if (!queue) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    if (queue.paused) return interaction.reply({ content: 'Already paused. Use `/resume` to continue.', flags: MessageFlags.Ephemeral });
    try {
      distube.pause(interaction.guild.id);
      await interaction.reply({ content: `⏸️ Paused by ${interaction.user}.` });
    } catch (err) {
      await interaction.reply({ content: `Couldn't pause: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  },
};
