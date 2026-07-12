import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags,
} from 'discord.js';
import {
  getConfig, setCalendarChannel, setCalendarSource, clearCalendar,
} from '../../db/index.js';
import { regenerateCalendar, isValidTz } from '../../features/calendar.js';

const MONTH_CHOICES = [
  { name: 'This month', value: 'this' },
  { name: 'Next month', value: 'next' },
  { name: 'Previous month', value: 'prev' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('A full month-grid calendar image (from Ready Room), kept pinned in a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s
      .setName('setup')
      .setDescription('Pick the channel and post the Ready Room calendar.')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to keep the pinned calendar in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addStringOption((o) => o.setName('timezone').setDescription('IANA timezone for dates/times, e.g. America/Denver (default)'))
      .addStringOption((o) => o.setName('title').setDescription('Optional heading, e.g. "132nd Ops" (defaults to the wing name)'))
      .addStringOption((o) => o.setName('source_url').setDescription('Optional Ready Room /share/<token> URL override (else uses the linked wing)')))
    .addSubcommand((s) => s
      .setName('refresh')
      .setDescription('Regenerate the calendar image now.')
      .addStringOption((o) => o.setName('month').setDescription('Which month to show').addChoices(...MONTH_CHOICES)))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current calendar configuration.'))
    .addSubcommand((s) => s.setName('off').setDescription('Stop auto-updating (the pinned image stays).')),

  async execute(interaction, client) {
    const guildId = interaction.guild?.id;
    if (!guildId) return interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const cfg = getConfig(guildId);
      if (!cfg.calendar_channel_id) return interaction.reply({ content: 'No calendar set up yet. Run `/calendar setup`.', flags: MessageFlags.Ephemeral });
      let src = {};
      try { src = cfg.calendar_source ? JSON.parse(cfg.calendar_source) : {}; } catch { /* ignore */ }
      const last = cfg.calendar_last_run ? `<t:${Math.floor(cfg.calendar_last_run / 1000)}:R>` : 'never';
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: [
          '**Calendar**',
          `• Channel: <#${cfg.calendar_channel_id}>`,
          `• Source: Ready Room${src.source_url ? ` (${src.source_url})` : ' (linked wing)'}`,
          `• Timezone: \`${src.tz || 'America/Denver'}\``,
          src.title ? `• Title: ${src.title}` : null,
          `• Last updated: ${last}`,
        ].filter(Boolean).join('\n'),
      });
    }

    if (sub === 'off') {
      clearCalendar(guildId);
      return interaction.reply({ content: '🛑 Calendar auto-updates stopped. The last pinned image stays until you delete it.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'refresh') {
      const cfg = getConfig(guildId);
      if (!cfg.calendar_channel_id) return interaction.reply({ content: 'No calendar set up yet. Run `/calendar setup`.', flags: MessageFlags.Ephemeral });
      const month = interaction.options.getString('month') || 'this';
      const offset = month === 'next' ? 1 : month === 'prev' ? -1 : 0;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await regenerateCalendar(client, guildId, { monthOffset: offset });
        return interaction.editReply('🔄 Calendar refreshed.');
      } catch (e) {
        return interaction.editReply(`⚠️ Couldn’t refresh: ${e.message}`);
      }
    }

    // setup
    const channel = interaction.options.getChannel('channel');
    const tz = interaction.options.getString('timezone') || 'America/Denver';
    const title = interaction.options.getString('title');
    const sourceUrl = interaction.options.getString('source_url');

    if (!isValidTz(tz)) return interaction.reply({ content: `❌ \`${tz}\` isn’t a valid IANA timezone (e.g. \`America/Denver\`, \`Europe/London\`, \`UTC\`).`, flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    setCalendarChannel(guildId, channel.id);
    setCalendarSource(guildId, { source_url: sourceUrl || null, tz, title: title || null });
    try {
      await regenerateCalendar(client, guildId);
      return interaction.editReply(`✅ Calendar posted & pinned in ${channel}. It auto-updates daily; run \`/calendar refresh\` anytime.`);
    } catch (e) {
      return interaction.editReply(`⚠️ Settings saved, but the first render failed: ${e.message}\nFix the Ready Room link and run \`/calendar refresh\`.`);
    }
  },
};
