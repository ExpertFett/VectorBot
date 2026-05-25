import { incrementInvite } from '../db/index.js';

// guildId -> Map(code -> uses)
const cache = new Map();

export async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    cache.set(guild.id, new Map(invites.map((i) => [i.code, i.uses ?? 0])));
  } catch {
    // Missing Manage Server permission — invite tracking won't work until granted.
  }
}

export async function cacheAllInvites(client) {
  for (const guild of client.guilds.cache.values()) await cacheGuildInvites(guild);
}

export function addInviteToCache(invite) {
  if (!invite.guild) return;
  const g = cache.get(invite.guild.id) || new Map();
  g.set(invite.code, invite.uses ?? 0);
  cache.set(invite.guild.id, g);
}

export function removeInviteFromCache(invite) {
  cache.get(invite.guild?.id)?.delete(invite.code);
}

// On join, diff current invite uses against the cache to find which was used.
export async function detectInviteUsed(member) {
  const guild = member.guild;
  const before = cache.get(guild.id) || new Map();
  let current;
  try {
    current = await guild.invites.fetch();
  } catch {
    return;
  }
  let used = null;
  for (const inv of current.values()) {
    if ((inv.uses ?? 0) > (before.get(inv.code) ?? 0)) { used = inv; break; }
  }
  cache.set(guild.id, new Map(current.map((i) => [i.code, i.uses ?? 0])));
  if (used?.inviter) incrementInvite(guild.id, used.inviter.id);
}
