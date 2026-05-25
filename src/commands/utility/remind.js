import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { addReminder } from '../../db/index.js';
import { parseDuration } from '../../util/time.js';

const MIN_MS = 5_000;
const MAX_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export default {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a reminder.')
    .addStringOption((o) => o.setName('when').setDescription('e.g. 10m, 2h, 1d, 1h30m').setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('What to remind you about').setRequired(true)),

  async execute(interaction) {
    const ms = parseDuration(interaction.options.getString('when'));
    if (!ms || ms < MIN_MS || ms > MAX_MS) {
      return interaction.reply({ content: 'Invalid time. Use formats like `10m`, `2h`, `1d`, `1h30m` (5s–60d).', flags: MessageFlags.Ephemeral });
    }
    const remindAt = Date.now() + ms;
    addReminder({
      guildId: interaction.guild.id,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      message: interaction.options.getString('message'),
      remindAt,
    });
    await interaction.reply({ content: `Okay! I’ll remind you <t:${Math.floor(remindAt / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
  },
};
