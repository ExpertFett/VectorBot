import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags,
} from 'discord.js';
import { getConfig, setConfigValue } from '../../db/index.js';

const PLACEHOLDER_HELP =
  'Placeholders: `{user}` (mention), `{username}`, `{server}`, `{membercount}`';

export default {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure welcome, goodbye, and auto-role settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('welcome')
        .setDescription('Set the welcome channel and message.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for welcome messages')
            .addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption((o) =>
          o.setName('message').setDescription('Welcome text. ' + PLACEHOLDER_HELP).setRequired(true)))
    .addSubcommand((s) =>
      s.setName('goodbye')
        .setDescription('Set the goodbye channel and message.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for goodbye messages')
            .addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption((o) =>
          o.setName('message').setDescription('Goodbye text. ' + PLACEHOLDER_HELP).setRequired(true)))
    .addSubcommand((s) =>
      s.setName('autorole')
        .setDescription('Set a role automatically assigned to new members.')
        .addRoleOption((o) =>
          o.setName('role').setDescription('Role to auto-assign on join').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('disable')
        .setDescription('Turn off a feature.')
        .addStringOption((o) =>
          o.setName('feature').setDescription('Which feature to disable').setRequired(true)
            .addChoices(
              { name: 'welcome', value: 'welcome' },
              { name: 'goodbye', value: 'goodbye' },
              { name: 'autorole', value: 'autorole' },
            )))
    .addSubcommand((s) => s.setName('show').setDescription('Show the current configuration.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'welcome') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      setConfigValue(guildId, 'welcome_channel_id', channel.id);
      setConfigValue(guildId, 'welcome_message', message);
      return interaction.reply({ content: `Welcome messages will post in ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'goodbye') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      setConfigValue(guildId, 'goodbye_channel_id', channel.id);
      setConfigValue(guildId, 'goodbye_message', message);
      return interaction.reply({ content: `Goodbye messages will post in ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'autorole') {
      const role = interaction.options.getRole('role');
      const me = interaction.guild.members.me;
      if (role.managed) {
        return interaction.reply({ content: 'That role is managed by an integration and can\'t be auto-assigned.', flags: MessageFlags.Ephemeral });
      }
      if (me && role.position >= me.roles.highest.position) {
        return interaction.reply({ content: `I can't assign **${role.name}** — move my role above it in Server Settings → Roles.`, flags: MessageFlags.Ephemeral });
      }
      setConfigValue(guildId, 'autorole_id', role.id);
      return interaction.reply({ content: `New members will receive **${role.name}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'disable') {
      const feature = interaction.options.getString('feature');
      if (feature === 'welcome') {
        setConfigValue(guildId, 'welcome_channel_id', null);
        setConfigValue(guildId, 'welcome_message', null);
      } else if (feature === 'goodbye') {
        setConfigValue(guildId, 'goodbye_channel_id', null);
        setConfigValue(guildId, 'goodbye_message', null);
      } else if (feature === 'autorole') {
        setConfigValue(guildId, 'autorole_id', null);
      }
      return interaction.reply({ content: `Disabled **${feature}**.`, flags: MessageFlags.Ephemeral });
    }

    // show
    const c = getConfig(guildId);
    const fmtChannel = (id) => (id ? `<#${id}>` : '*not set*');
    const fmtRole = (id) => (id ? `<@&${id}>` : '*not set*');
    const embed = new EmbedBuilder()
      .setTitle(`Configuration for ${interaction.guild.name}`)
      .addFields(
        { name: 'Welcome channel', value: fmtChannel(c.welcome_channel_id), inline: true },
        { name: 'Welcome message', value: c.welcome_message ? `\`\`\`${c.welcome_message}\`\`\`` : '*not set*' },
        { name: 'Goodbye channel', value: fmtChannel(c.goodbye_channel_id), inline: true },
        { name: 'Goodbye message', value: c.goodbye_message ? `\`\`\`${c.goodbye_message}\`\`\`` : '*not set*' },
        { name: 'Auto-role', value: fmtRole(c.autorole_id), inline: true },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
