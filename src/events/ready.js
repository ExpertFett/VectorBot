import { Events, ActivityType } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag} — serving ${client.guilds.cache.size} guild(s).`);
    client.user.setActivity('the skies | /help', { type: ActivityType.Watching });

    // Auto-sync slash commands to the configured guild so they appear instantly,
    // with no separate deploy step. Global registration still uses `npm run deploy`.
    const guildId = process.env.DISCORD_GUILD_ID;
    if (guildId) {
      try {
        const data = [...client.commands.values()].map((c) => c.data.toJSON());
        await client.application.commands.set(data, guildId);
        console.log(`Synced ${data.length} command(s) to guild ${guildId}.`);
      } catch (err) {
        console.error('Failed to sync guild commands:', err.message);
      }
    }
  },
};
