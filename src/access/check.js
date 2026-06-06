// Permission check used by both the bot and the dashboard.
// Rule order (first match wins):
//   1. Owner of the guild → always allowed
//   2. ManageGuild permission → always allowed (admins bypass overrides)
//   3. Per-action override in guild_config.permission_overrides:
//        - mode='everyone' → allowed
//        - mode='groups'   → allowed if member has any role in any listed group
//        - mode='admin' (or no override) → NOT allowed (admins already handled above)
//
// `member` may be a discord.js GuildMember or a lightweight shape
// `{ id, isOwner, isAdmin, roleIds }` so the dashboard can check too.

import { PermissionsBitField } from 'discord.js';
import { getPermissionOverrides, getAccessGroup } from '../db/index.js';

function asLight(member) {
  if (!member) return null;
  if (typeof member.isOwner === 'boolean') return member; // already light
  const guildId = member.guild?.id || null;
  const isOwner = member.guild?.ownerId === member.id;
  const isAdmin = !!member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild);
  const roleIds = member.roles?.cache ? [...member.roles.cache.keys()] : [];
  return { id: member.id, guildId, isOwner, isAdmin, roleIds };
}

export function canPerform(member, actionKey) {
  const m = asLight(member);
  if (!m || !m.guildId) return false;
  if (m.isOwner || m.isAdmin) return true;

  const overrides = getPermissionOverrides(m.guildId);
  const override = overrides[actionKey];
  if (!override || override.mode === 'admin') return false;
  if (override.mode === 'everyone') return true;
  if (override.mode === 'groups') {
    const gids = Array.isArray(override.group_ids) ? override.group_ids : [];
    for (const gid of gids) {
      const grp = getAccessGroup(m.guildId, gid);
      if (!grp) continue;
      if (grp.role_ids.some((rid) => m.roleIds.includes(rid))) return true;
    }
  }
  return false;
}

// Dashboard-side helper: when the API handler knows the user's role IDs in the
// selected guild, build the light shape and check.
export function canPerformFromSession({ guildId, isOwner, isAdmin, roleIds }, actionKey) {
  return canPerform({ id: 'session', guildId, isOwner, isAdmin, roleIds: roleIds || [] }, actionKey);
}
