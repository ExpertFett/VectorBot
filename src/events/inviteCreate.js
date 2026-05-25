import { Events } from 'discord.js';
import { addInviteToCache } from '../features/invites.js';

export default {
  name: Events.InviteCreate,
  execute(invite) {
    addInviteToCache(invite);
  },
};
