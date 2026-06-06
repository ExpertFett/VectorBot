// Detect role changes on a member and fire member.role_added / role_removed
// automation triggers for each role that came or went. We fire one trigger
// per role so a rule that matches role X doesn't also fire for role Y.

import { Events } from 'discord.js';
import { fireTrigger } from '../automations/engine.js';

export default {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember, mainClient) {
    if (!newMember.guild) return;
    const oldRoles = oldMember.roles?.cache;
    const newRoles = newMember.roles?.cache;
    if (!oldRoles || !newRoles) return;

    const added = [...newRoles.keys()].filter((id) => !oldRoles.has(id));
    const removed = [...oldRoles.keys()].filter((id) => !newRoles.has(id));
    if (!added.length && !removed.length) return;

    const guild = newMember.guild;
    for (const id of added) {
      const role = guild.roles.cache.get(id);
      if (!role) continue;
      fireTrigger('member.role_added', { guild, member: newMember, user: newMember.user, role }, mainClient).catch(() => {});
    }
    for (const id of removed) {
      const role = guild.roles.cache.get(id);
      if (!role) continue;
      fireTrigger('member.role_removed', { guild, member: newMember, user: newMember.user, role }, mainClient).catch(() => {});
    }
  },
};
