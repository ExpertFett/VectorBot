import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { getMusic, nowPlayingButtons } from '../../features/music.js';
import { getPersonalization } from '../../db/index.js';

// "Now playing" — useful when the original now-playing embed has scrolled away.
export default {
  data: new SlashCommandBuilder()
    .setName('np')
    .setDescription('Show what\'s currently playing with a progress bar.'),

  async execute(interaction) {
    const distube = getMusic();
    const queue = distube?.getQueue(interaction.guild.id);
    if (!queue || !queue.songs.length) {
      return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }
    const accent = getPersonalization(interaction.guild.id).embed_color ?? 0x9119f5;
    const song = queue.songs[0];
    const total = song.duration || 0;
    const current = Math.max(0, Math.floor(queue.currentTime || 0));

    // ASCII progress bar — 20 cells wide, no chart library.
    const cells = 20;
    const filled = total ? Math.min(cells, Math.round((current / total) * cells)) : 0;
    const bar = '█'.repeat(filled) + '─'.repeat(cells - filled);
    const fmt = (s) => {
      if (!s || !isFinite(s)) return '—';
      const m = Math.floor(s / 60);
      const r = Math.floor(s % 60).toString().padStart(2, '0');
      return `${m}:${r}`;
    };

    const embed = new EmbedBuilder()
      .setColor(accent)
      .setAuthor({ name: queue.paused ? 'Now playing (paused)' : 'Now playing' })
      .setTitle(song.name?.slice(0, 256) || 'Untitled')
      .setURL(song.url || null)
      .setThumbnail(song.thumbnail || null)
      .setDescription(`\`${fmt(current)}\` ${bar} \`${fmt(total)}\``)
      .addFields(
        { name: 'Requested by', value: song.user ? `<@${song.user.id}>` : '—', inline: true },
        { name: 'Volume',       value: `${queue.volume}%`,                     inline: true },
        { name: 'Queue',        value: queue.songs.length > 1 ? `${queue.songs.length - 1} more` : 'last in queue', inline: true },
      );
    await interaction.reply({ embeds: [embed], components: [nowPlayingButtons()] });
  },
};
