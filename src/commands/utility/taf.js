import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('taf')
    .setDescription('Terminal Aerodrome Forecast (TAF) for an airport.')
    .addStringOption((o) => o.setName('icao').setDescription('ICAO code, e.g. KLSV').setRequired(true)),

  async execute(interaction) {
    const icao = interaction.options.getString('icao').trim().toUpperCase().slice(0, 8);
    if (!/^[A-Z0-9]{3,4}$/.test(icao)) {
      return interaction.reply({ content: 'Enter a valid ICAO code (e.g. `KLSV`).', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    try {
      const res = await fetch(`https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`, { headers: { 'User-Agent': 'VectorBot' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const t = Array.isArray(data) ? data[0] : null;
      if (!t || !t.rawTAF) return interaction.editReply(`No TAF found for **${icao}**.`);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`TAF — ${t.icaoId || icao}`).setDescription('```' + t.rawTAF + '```')] });
    } catch (err) {
      console.error('TAF fetch failed:', err.message);
      await interaction.editReply(`Couldn’t fetch TAF for **${icao}** right now.`);
    }
  },
};
