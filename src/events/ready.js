import { Events, ActivityType } from 'discord.js';
import { cacheAllInvites } from '../features/invites.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag} — serving ${client.guilds.cache.size} guild(s).`);
    client.user.setActivity('the skies | /play · /help', { type: ActivityType.Watching });

    // Multi-server: register commands globally so they work in every server the
    // bot joins. Also sync to the home guild (if set) for instant availability there
    // — a same-named guild command overrides the global one, so no duplicates appear.
    const data = [...client.commands.values()].map((c) => c.data.toJSON());
    try {
      await client.application.commands.set(data);
      console.log(`Registered ${data.length} global command(s).`);
    } catch (err) {
      console.error('Failed to register global commands:', err.message);
    }
    const homeGuild = process.env.DISCORD_GUILD_ID;
    if (homeGuild) {
      try {
        await client.application.commands.set(data, homeGuild);
        console.log(`Synced ${data.length} command(s) to home guild ${homeGuild}.`);
      } catch (err) {
        console.error('Failed to sync home-guild commands:', err.message);
      }
    }

    // Cache invites in every guild so we can attribute joins (invite tracker).
    await cacheAllInvites(client);
  },
};
