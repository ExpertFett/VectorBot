import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { addModLog } from '../../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Temporarily mute (time out) a member, or remove an active timeout.')
    .addUserOption((o) => o.setName('user').setDescription('User to time out').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('duration')
        .setDescription('How long to time out for')
        .setRequired(true)
        .addChoices(
          { name: 'Remove timeout', value: 0 },
          { name: '60 seconds', value: 60 },
          { name: '5 minutes', value: 300 },
          { name: '10 minutes', value: 600 },
          { name: '1 hour', value: 3600 },
          { name: '1 day', value: 86400 },
          { name: '1 week', value: 604800 },
        ))
    .addStringOption((o) => o.setName('reason').setDescription('Reason'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const seconds = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: 'That user is not in this server.', flags: MessageFlags.Ephemeral });
    }
    if (!member.moderatable) {
      return interaction.reply({
        content: "I can't time out that user — their role is higher than mine, or I lack permission.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      if (seconds === 0) {
        await member.timeout(null, `Timeout removed by ${interaction.user.tag}`);
        addModLog({
          guildId: interaction.guild.id, action: 'untimeout',
          targetId: user.id, targetTag: user.tag,
          moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason: null,
        });
        return interaction.reply(`Removed timeout from **${user.tag}**.`);
      }
      await member.timeout(seconds * 1000, `${reason} — by ${interaction.user.tag}`);
      addModLog({
        guildId: interaction.guild.id, action: 'timeout',
        targetId: user.id, targetTag: user.tag,
        moderatorId: interaction.user.id, moderatorTag: interaction.user.tag,
        reason: `${reason} (${seconds}s)`,
      });
      await interaction.reply(`Timed out **${user.tag}**. Reason: ${reason}`);
    } catch (err) {
      console.error('Timeout failed:', err);
      await interaction.reply({ content: 'Failed to time out that user.', flags: MessageFlags.Ephemeral });
    }
  },
};
