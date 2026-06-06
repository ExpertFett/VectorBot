import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';

const CAT_COLORS = { VFR: 0x2ecc71, MVFR: 0x3498db, IFR: 0xe74c3c, LIFR: 0x9b59b6 };

export default {
  data: new SlashCommandBuilder()
    .setName('metar')
    .setDescription('Latest real-world METAR for an airport (matches DCS theatres).')
    .addStringOption((o) => o.setName('icao').setDescription('ICAO code, e.g. KLSV, UGKO, LCRA').setRequired(true)),

  async execute(interaction) {
    const icao = interaction.options.getString('icao').trim().toUpperCase().slice(0, 8);
    if (!/^[A-Z0-9]{3,4}$/.test(icao)) {
      return interaction.reply({ content: 'Enter a valid ICAO code (e.g. `KLSV`).', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    try {
      const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`, { headers: { 'User-Agent': 'VectorBot' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return interaction.editReply(`No METAR found for **${icao}**.`);

      const m = data[0];
      const cat = m.fltCat || '—';
      const embed = new EmbedBuilder()
        .setColor(CAT_COLORS[cat] || 0x9119f5)
        .setTitle(`METAR — ${m.name || icao} (${m.icaoId || icao})`)
        .setDescription('```' + (m.rawOb || 'n/a') + '```')
        .addFields(
          { name: 'Flight category', value: cat, inline: true },
          { name: 'Observed', value: m.obsTime ? `<t:${m.obsTime}:R>` : '—', inline: true },
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('METAR fetch failed:', err.message);
      await interaction.editReply(`Couldn’t fetch METAR for **${icao}** right now.`);
    }
  },
};
