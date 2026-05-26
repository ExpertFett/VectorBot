import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getRosterEntry } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Show a pilot\'s roster card.')
    .addUserOption((o) => o.setName('pilot').setDescription('Pilot to look up (defaults to you)')),

  async execute(interaction) {
    const user = interaction.options.getUser('pilot') ?? interaction.user;
    const entry = getRosterEntry(interaction.guild.id, user.id);
    if (!entry) {
      return interaction.reply({ content: `No roster entry for **${user.username}** yet.`, flags: MessageFlags.Ephemeral });
    }
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(entry.callsign ? `${entry.callsign} — ${user.username}` : user.username)
      .setThumbnail(user.displayAvatarURL());
    if (entry.airframes) embed.addFields({ name: 'Airframes', value: entry.airframes });
    if (entry.quals) embed.addFields({ name: 'Qualifications', value: entry.quals });
    if (entry.notes) embed.addFields({ name: 'Notes', value: entry.notes });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
