import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getBombLeaderboard } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder().setName('bombscores').setDescription('Bombing-accuracy leaderboard (vs the TGT marker).'),

  async execute(interaction) {
    const board = getBombLeaderboard(interaction.guild.id);
    if (!board.length) {
      return interaction.reply({ content: 'No bomb scores yet — place a map marker starting with **TGT** and drop on it with the hook running.', flags: MessageFlags.Ephemeral });
    }
    const lines = board.slice(0, 20).map((r, i) =>
      `**${i + 1}.** ${r.pilot} — avg **${r.avg_m} m** · best ${r.best_m} m · ${r.drops} drop${r.drops === 1 ? '' : 's'}`);
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('💣 Bombing Accuracy (lower is better)').setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed] });
  },
};
