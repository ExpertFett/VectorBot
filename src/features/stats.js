import { getAllStatChannels } from '../db/index.js';

export const STAT_TYPES = ['members', 'humans', 'bots', 'boosts', 'roles', 'channels'];

export function computeStat(guild, type, members) {
  switch (type) {
    case 'bots': return members ? members.filter((m) => m.user.bot).size : 0;
    case 'humans': return members ? members.filter((m) => !m.user.bot).size : guild.memberCount;
    case 'boosts': return guild.premiumSubscriptionCount || 0;
    case 'roles': return Math.max(0, guild.roles.cache.size - 1); // exclude @everyone
    case 'channels': return guild.channels.cache.size;
    case 'members':
    default: return guild.memberCount;
  }
}

export async function updateStatChannels(client) {
  const byGuild = new Map();
  for (const s of getAllStatChannels()) {
    if (!byGuild.has(s.guild_id)) byGuild.set(s.guild_id, []);
    byGuild.get(s.guild_id).push(s);
  }

  for (const [guildId, list] of byGuild) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    // Only fetch the full member list if a counter needs the human/bot split.
    let members = null;
    if (list.some((s) => s.type === 'bots' || s.type === 'humans')) {
      members = await guild.members.fetch().catch(() => null);
    }

    for (const s of list) {
      const channel = guild.channels.cache.get(s.channel_id);
      if (!channel) continue;
      const value = computeStat(guild, s.type, members);
      const name = (s.template || '{count}').replace('{count}', value.toLocaleString());
      if (channel.name !== name) await channel.setName(name).catch(() => {});
    }
  }
}
