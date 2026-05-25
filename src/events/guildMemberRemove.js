import { Events } from 'discord.js';
import { getConfig } from '../db/index.js';
import { applyPlaceholders } from '../util/format.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member) {
    const config = getConfig(member.guild.id);
    if (!config.goodbye_channel_id || !config.goodbye_message) return;

    const channel = member.guild.channels.cache.get(config.goodbye_channel_id);
    if (!channel?.isTextBased()) return;

    // A departed member can no longer be mentioned, so use the plain username.
    const text = applyPlaceholders(config.goodbye_message, { member, guild: member.guild, mention: false });
    await channel.send(text).catch((err) => console.error('Goodbye send failed:', err.message));
  },
};
