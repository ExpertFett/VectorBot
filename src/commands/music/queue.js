import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { getMusic } from '../../features/music.js';
import { getPersonalization } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show what\'s playing and what\'s up next.'),

  async execute(interaction) {
    const distube = getMusic();
    const queue = distube?.getQueue(interaction.guild.id);
    if (!queue || !queue.songs.length) {
      return interaction.reply({ content: 'Queue is empty.', flags: MessageFlags.Ephemeral });
    }
    const accent = getPersonalization(interaction.guild.id).embed_color ?? 0x9119f5;
    const [current, ...upcoming] = queue.songs;
    const lines = upcoming.slice(0, 10).map((s, i) => {
      const title = (s.name || 'Untitled').slice(0, 80);
      const dur = s.formattedDuration || '—';
      return `**${i + 1}.** [${title}](${s.url || ''}) · \`${dur}\``;
    });
    if (upcoming.length > 10) lines.push(`*…and ${upcoming.length - 10} more*`);
    const embed = new EmbedBuilder()
      .setColor(accent)
      .setAuthor({ name: queue.paused ? 'Queue (paused)' : 'Queue' })
      .setTitle(`Now: ${current.name?.slice(0, 200) || 'Untitled'}`)
      .setURL(current.url || null)
      .setThumbnail(current.thumbnail || null)
      .setDescription(lines.length ? lines.join('\n') : '_No upcoming songs._')
      .setFooter({ text: `${queue.songs.length} song${queue.songs.length === 1 ? '' : 's'} · Volume ${queue.volume}%` });
    await interaction.reply({ embeds: [embed] });
  },
};
