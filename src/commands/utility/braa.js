import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { parseLatLon, mgrsToLatLon, bearingRange } from '../../util/geo.js';

const resolve = (s) => parseLatLon(s) || mgrsToLatLon(s);

export default {
  data: new SlashCommandBuilder()
    .setName('braa')
    .setDescription('Bearing & range from point A to point B.')
    .addStringOption((o) => o.setName('from').setDescription('A: "lat, lon" or MGRS').setRequired(true))
    .addStringOption((o) => o.setName('to').setDescription('B: "lat, lon" or MGRS').setRequired(true)),

  async execute(interaction) {
    const a = resolve(interaction.options.getString('from'));
    const b = resolve(interaction.options.getString('to'));
    if (!a || !b) return interaction.reply({ content: 'Couldn’t parse one of the points.', flags: MessageFlags.Ephemeral });
    const r = bearingRange(a, b);
    await interaction.reply({ content: `**${String(r.bearing).padStart(3, '0')}° / ${r.nm.toFixed(1)} nm** (${r.km.toFixed(1)} km)`, flags: MessageFlags.Ephemeral });
  },
};
