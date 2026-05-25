import { SlashCommandBuilder, EmbedBuilder, MessageFlags, time } from 'discord.js';

export default {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server.'),

  async execute(interaction) {
    const { guild } = interaction;
    const owner = await guild.fetchOwner().catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'Members', value: String(guild.memberCount), inline: true },
        { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
        { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
        { name: 'Owner', value: owner ? owner.user.tag : 'Unknown', inline: true },
        { name: 'Boosts', value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
        { name: 'Created', value: time(guild.createdAt, 'R'), inline: true },
      )
      .setFooter({ text: `Server ID: ${guild.id}` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
