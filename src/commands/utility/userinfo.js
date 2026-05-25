import { SlashCommandBuilder, EmbedBuilder, MessageFlags, time } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show information about a user.')
    .addUserOption((o) => o.setName('user').setDescription('User to look up (defaults to you)')),

  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: 'Account created', value: time(user.createdAt, 'R'), inline: false },
      );

    if (member) {
      if (member.joinedAt) embed.addFields({ name: 'Joined server', value: time(member.joinedAt, 'R'), inline: false });
      const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).map((r) => r.toString());
      embed.addFields({ name: `Roles (${roles.length})`, value: roles.join(' ') || 'None' });
      if (member.displayHexColor) embed.setColor(member.displayColor || null);
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
