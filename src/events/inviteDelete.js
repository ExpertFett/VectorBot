import { Events } from 'discord.js';
import { removeInviteFromCache } from '../features/invites.js';

export default {
  name: Events.InviteDelete,
  execute(invite) {
    removeInviteFromCache(invite);
  },
};
