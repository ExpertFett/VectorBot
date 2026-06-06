import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getTrapLeaderboard } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder().setName('traps').setDescription('Carrier trap (LSO) leaderboard.'),

  async execute(interaction) {
    const board = getTrapLeaderboard(interaction.guild.id);
    if (!board.length) {
      return interaction.reply({ content: 'No traps logged yet — they appear once the DCS hook is running and pilots recover aboard the boat.', flags: MessageFlags.Ephemeral });
    }
    const lines = board.slice(0, 20).map((r, i) =>
      `**${i + 1}.** ${r.pilot} — avg **${r.avg_points}** · ${r.traps} trap${r.traps === 1 ? '' : 's'} · best ${r.best}`);
    const embed = new EmbedBuilder().setColor(0x9119f5).setTitle('🪝 Carrier Trap Leaderboard').setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed] });
  },
};
