import { incrementInvite, getConfig } from '../db/index.js';

// guildId -> Map(code -> uses)
const cache = new Map();

export async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    cache.set(guild.id, new Map(invites.map((i) => [i.code, i.uses ?? 0])));
  } catch (err) {
    // Almost always: the bot lacks Manage Server in this guild, so it can't
    // read the invite list. Log it (once per guild per boot) instead of failing
    // silently, so "invite tracker isn't working" is diagnosable from the logs.
    console.warn(`[invites] cannot read invites for "${guild.name}" (${guild.id}) — grant the bot Manage Server. (${err.message})`);
  }
}

// Whether the bot can currently read invites in this guild (Manage Server).
// Used by the dashboard to warn the admin if the permission is missing.
export async function canTrackInvites(guild) {
  try { await guild.invites.fetch(); return true; }
  catch { return false; }
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
  if (!used?.inviter) return;

  incrementInvite(guild.id, used.inviter.id);

  const logChannelId = getConfig(guild.id).invite_log_channel;
  if (logChannelId) {
    const ch = guild.channels.cache.get(logChannelId);
    if (ch?.isTextBased()) {
      ch.send(`📨 **${member.user.tag}** joined — invited by <@${used.inviter.id}> (invite \`${used.code}\`).`).catch(() => {});
    }
  }
}
