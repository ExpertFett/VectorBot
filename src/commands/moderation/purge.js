import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';

// Content-type filters. Each maps to a predicate over a message.
const FILTERS = {
  bots: (m) => m.author.bot,
  humans: (m) => !m.author.bot,
  links: (m) => /https?:\/\//i.test(m.content),
  attachments: (m) => m.attachments.size > 0,
  embeds: (m) => m.embeds.length > 0,
};

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
    .addStringOption((o) =>
      o.setName('filter')
        .setDescription('Only delete a certain kind of message')
        .addChoices(
          { name: 'Bots only', value: 'bots' },
          { name: 'Humans only', value: 'humans' },
          { name: 'Has a link', value: 'links' },
          { name: 'Has an attachment/image', value: 'attachments' },
          { name: 'Has an embed', value: 'embeds' },
        ))
    .addStringOption((o) => o.setName('contains').setDescription('Only delete messages containing this text'))
    .addBooleanOption((o) => o.setName('include_pinned').setDescription('Also delete pinned messages (default: protected)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('user');
    const filterKey = interaction.options.getString('filter');
    const contains = interaction.options.getString('contains');
    const includePinned = interaction.options.getBoolean('include_pinned') ?? false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let messages = await interaction.channel.messages.fetch({ limit: 100 });

    // Apply filters before slicing to the requested amount.
    let skippedPinned = false;
    if (!includePinned) {
      const before = messages.size;
      messages = messages.filter((m) => !m.pinned);
      skippedPinned = messages.size < before;
    }
    if (targetUser) messages = messages.filter((m) => m.author.id === targetUser.id);
    if (filterKey && FILTERS[filterKey]) messages = messages.filter(FILTERS[filterKey]);
    if (contains) {
      const needle = contains.toLowerCase();
      messages = messages.filter((m) => m.content.toLowerCase().includes(needle));
    }

    const toDelete = [...messages.values()].slice(0, amount);
    if (toDelete.length === 0) {
      return interaction.editReply('No messages matched those filters in the last 100 messages.');
    }

    // bulkDelete only removes messages younger than 14 days; filterOld=true drops the rest.
    const deleted = await interaction.channel.bulkDelete(toDelete, true);

    const bits = [];
    if (targetUser) bits.push(`from **${targetUser.tag}**`);
    if (filterKey) bits.push(`(${filterKey})`);
    if (contains) bits.push(`containing “${contains}”`);
    await interaction.editReply(
      `Deleted **${deleted.size}** message(s)${bits.length ? ' ' + bits.join(' ') : ''}.` +
      (deleted.size < toDelete.length ? '\n*(Messages older than 14 days can\'t be bulk-deleted.)*' : '') +
      (skippedPinned ? '\n*(Pinned messages were protected — pass `include_pinned: True` to remove them too.)*' : '')
    );
  },
};
