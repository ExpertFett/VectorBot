import { Events } from 'discord.js';
import { getConfig, getPersonalization } from '../db/index.js';
import { applyPlaceholders } from '../util/format.js';
import { buildEmbed } from '../util/embed.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member) {
    const config = getConfig(member.guild.id);
    if (!config.goodbye_channel_id) return;

    const channel = member.guild.channels.cache.get(config.goodbye_channel_id);
    if (!channel?.isTextBased()) return;

    // A departed member can no longer be mentioned, so use the plain username.
    const sub = (s) => applyPlaceholders(s, { member, guild: member.guild, mention: false });
    const payload = {};
    if (config.goodbye_message) payload.content = sub(config.goodbye_message);
    const accent = getPersonalization(member.guild.id).embed_color ?? undefined;
    const embed = config.goodbye_embed ? buildEmbed(config.goodbye_embed, sub, accent) : null;
    if (embed) payload.embeds = [embed];

    if (payload.content || payload.embeds) {
      await channel.send(payload).catch((err) => console.error('Goodbye send failed:', err.message));
    }
  },
};
