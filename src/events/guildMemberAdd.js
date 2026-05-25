import { Events } from 'discord.js';
import { getConfig } from '../db/index.js';
import { applyPlaceholders } from '../util/format.js';
import { buildEmbed } from '../util/embed.js';
import { detectInviteUsed } from '../features/invites.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // Attribute the join to an invite before anything else (invite tracker).
    await detectInviteUsed(member).catch(() => {});

    const config = getConfig(member.guild.id);

    // Auto-role
    if (config.autorole_id) {
      try {
        await member.roles.add(config.autorole_id, 'Auto-role on join');
      } catch (err) {
        console.error(`Auto-role failed in ${member.guild.id}:`, err.message);
      }
    }

    // Welcome message (text and/or embed)
    if (!config.welcome_channel_id) return;
    const channel = member.guild.channels.cache.get(config.welcome_channel_id);
    if (!channel?.isTextBased()) return;

    const sub = (s) => applyPlaceholders(s, { member, guild: member.guild });
    const payload = {};
    if (config.welcome_message) payload.content = sub(config.welcome_message);
    const embed = config.welcome_embed ? buildEmbed(config.welcome_embed, sub) : null;
    if (embed) payload.embeds = [embed];

    if (payload.content || payload.embeds) {
      await channel.send(payload).catch((err) => console.error('Welcome send failed:', err.message));
    }
  },
};
