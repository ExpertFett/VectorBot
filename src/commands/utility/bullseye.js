import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { parseLatLon, mgrsToLatLon, bearingRange } from '../../util/geo.js';
import { getBullseye, setBullseye } from '../../db/index.js';

const resolve = (s) => parseLatLon(s) || mgrsToLatLon(s);

export default {
  data: new SlashCommandBuilder()
    .setName('bullseye')
    .setDescription('Set a bullseye reference, or get bearing/range from it to a point.')
    .addSubcommand((s) => s.setName('set').setDescription('Set the bullseye reference (Manage Server).')
      .addStringOption((o) => o.setName('coords').setDescription('"lat, lon" or MGRS').setRequired(true)))
    .addSubcommand((s) => s.setName('from').setDescription('Bearing/range from bullseye to a point.')
      .addStringOption((o) => o.setName('coords').setDescription('target "lat, lon" or MGRS').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const pt = resolve(interaction.options.getString('coords'));
    if (!pt) return interaction.reply({ content: 'Couldn’t parse those coordinates.', flags: MessageFlags.Ephemeral });

    if (sub === 'set') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need Manage Server to set the bullseye.', flags: MessageFlags.Ephemeral });
      }
      setBullseye(interaction.guild.id, pt.lat, pt.lon);
      return interaction.reply({ content: `Bullseye set to ${pt.lat.toFixed(4)}, ${pt.lon.toFixed(4)}.`, flags: MessageFlags.Ephemeral });
    }

    const be = getBullseye(interaction.guild.id);
    if (!be) return interaction.reply({ content: 'No bullseye set — an admin can run `/bullseye set`.', flags: MessageFlags.Ephemeral });
    const r = bearingRange(be, pt);
    await interaction.reply({ content: `From bullseye: **${String(r.bearing).padStart(3, '0')}° / ${r.nm.toFixed(1)} nm**`, flags: MessageFlags.Ephemeral });
  },
};
