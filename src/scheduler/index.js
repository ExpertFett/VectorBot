import {
  getScheduledDue, advanceScheduled, disableScheduled,
  getRemindersDue, deleteReminderById,
  getGiveawaysDue,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';
import { endGiveawayAndAnnounce } from '../features/giveaways.js';
import { pollYoutube } from '../features/youtube.js';
import { pollSocial } from '../features/social.js';
import { updateStatChannels } from '../features/stats.js';

const TICK_MS = 20_000;
const FEED_EVERY_TICKS = 15; // ~5 minutes (YouTube + social)
const STATS_EVERY_TICKS = 30; // ~10 minutes (channel-rename rate limits)
let feedCounter = 0;
let statsCounter = 0;

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
}

async function tick(client) {
  const now = Date.now();

  // Scheduled messages
  for (const s of getScheduledDue(now)) {
    const channel = await resolveChannel(client, s.channel_id);
    if (channel?.isTextBased()) {
      const payload = {};
      if (s.content) payload.content = s.content;
      const embed = s.embed ? buildEmbed(s.embed) : null;
      if (embed) payload.embeds = [embed];
      if (payload.content || payload.embeds) await channel.send(payload).catch(() => {});
    }
    // Advance to now + interval to avoid catch-up spam after downtime.
    if (s.type === 'interval' && s.interval_seconds) advanceScheduled(s.id, now + s.interval_seconds * 1000);
    else disableScheduled(s.id);
  }

  // Reminders
  for (const r of getRemindersDue(now)) {
    const channel = await resolveChannel(client, r.channel_id);
    if (channel?.isTextBased()) {
      await channel.send(`⏰ <@${r.user_id}>, reminder: ${r.message || '(no message)'}`).catch(() => {});
    }
    deleteReminderById(r.id);
  }

  // Giveaways ending
  for (const g of getGiveawaysDue(now)) {
    await endGiveawayAndAnnounce(client, g).catch((e) => console.error('Giveaway end error:', e.message));
  }

  // Feeds: YouTube + social (every ~5 min)
  if (++feedCounter >= FEED_EVERY_TICKS) {
    feedCounter = 0;
    await pollYoutube(client).catch((e) => console.error('YouTube poll error:', e.message));
    await pollSocial(client).catch((e) => console.error('Social poll error:', e.message));
  }

  // Stats counter channels (every ~10 min)
  if (++statsCounter >= STATS_EVERY_TICKS) {
    statsCounter = 0;
    await updateStatChannels(client).catch((e) => console.error('Stats update error:', e.message));
  }
}

export function startScheduler(client) {
  setInterval(() => { tick(client).catch((e) => console.error('Scheduler tick error:', e)); }, TICK_MS).unref();
  console.log('Scheduler started (20s tick).');
}
