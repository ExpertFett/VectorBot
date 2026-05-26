import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { parseLatLon, mgrsToLatLon, toDMS, toMGRS } from '../../util/geo.js';

export default {
  data: new SlashCommandBuilder()
    .setName('coords')
    .setDescription('Convert coordinates between Lat/Lon, DMS, and MGRS.')
    .addStringOption((o) => o.setName('value').setDescription('"37.5, -115.2", DMS, or an MGRS grid').setRequired(true)),

  async execute(interaction) {
    const v = interaction.options.getString('value').trim();
    const ll = parseLatLon(v) || mgrsToLatLon(v);
    if (!ll) {
      return interaction.reply({ content: 'Couldn’t parse that — use `lat, lon` decimal, DMS, or an MGRS grid.', flags: MessageFlags.Ephemeral });
    }
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('Coordinate conversion').addFields(
      { name: 'Lat / Lon', value: `${ll.lat.toFixed(6)}, ${ll.lon.toFixed(6)}` },
      { name: 'DMS', value: toDMS(ll) },
      { name: 'MGRS', value: toMGRS(ll) || 'n/a' },
    );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
