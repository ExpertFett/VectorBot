import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk-delete recent messages in this channel.')
    .addIntegerOption((o) =>
      o.setName('amount')
        .setDescription('How many messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('user');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let messages = await interaction.channel.messages.fetch({ limit: 100 });
    if (targetUser) messages = messages.filter((m) => m.author.id === targetUser.id);

    // bulkDelete only removes messages younger than 14 days; filterOld=true drops the rest.
    const toDelete = [...messages.values()].slice(0, amount);
    const deleted = await interaction.channel.bulkDelete(toDelete, true);

    await interaction.editReply(
      `Deleted **${deleted.size}** message(s)${targetUser ? ` from **${targetUser.tag}**` : ''}.` +
      (deleted.size < amount ? '\n*(Messages older than 14 days can\'t be bulk-deleted.)*' : '')
    );
  },
};
