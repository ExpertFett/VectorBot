import { Events } from 'discord.js';
import { getConfig } from '../db/index.js';
import { applyPlaceholders } from '../util/format.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const config = getConfig(member.guild.id);

    // Auto-role
    if (config.autorole_id) {
      try {
        await member.roles.add(config.autorole_id, 'Auto-role on join');
      } catch (err) {
        console.error(`Auto-role failed in ${member.guild.id}:`, err.message);
      }
    }

    // Welcome message
    if (config.welcome_channel_id && config.welcome_message) {
      const channel = member.guild.channels.cache.get(config.welcome_channel_id);
      if (channel?.isTextBased()) {
        const text = applyPlaceholders(config.welcome_message, { member, guild: member.guild });
        await channel.send(text).catch((err) => console.error('Welcome send failed:', err.message));
      }
    }
  },
};
