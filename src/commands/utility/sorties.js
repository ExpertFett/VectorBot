import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getSortieLeaderboard } from '../../db/index.js';

const fmt = (s) => {
  const m = Math.round((s || 0) / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default {
  data: new SlashCommandBuilder().setName('sorties').setDescription('Sortie / flight-time leaderboard.'),

  async execute(interaction) {
    const board = getSortieLeaderboard(interaction.guild.id);
    if (!board.length) {
      return interaction.reply({ content: 'No sorties logged yet — they record on takeoff → landing with the hook running.', flags: MessageFlags.Ephemeral });
    }
    const lines = board.slice(0, 20).map((r, i) =>
      `**${i + 1}.** ${r.pilot} — **${r.sorties}** sortie${r.sorties === 1 ? '' : 's'} · ${fmt(r.total_seconds)} airborne`);
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🛫 Sortie Log').setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed] });
  },
};
