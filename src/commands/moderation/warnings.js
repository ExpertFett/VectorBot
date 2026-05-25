import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, time } from 'discord.js';
import { getWarnings } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('List a member\'s warnings.')
    .addUserOption((o) => o.setName('user').setDescription('User to look up').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const warnings = getWarnings(interaction.guild.id, user.id);

    if (warnings.length === 0) {
      return interaction.reply({ content: `**${user.tag}** has no warnings.`, flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Warnings for ${user.tag}`)
      .setThumbnail(user.displayAvatarURL())
      .setDescription(`Total: **${warnings.length}**`)
      .addFields(
        warnings.slice(0, 25).map((w, i) => ({
          name: `#${i + 1} • ${time(Math.floor(w.created_at / 1000), 'R')}`,
          value: `${w.reason || 'No reason'} \n*by <@${w.moderator_id}>*`,
        }))
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
