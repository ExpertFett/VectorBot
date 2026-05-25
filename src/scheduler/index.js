import {
  getScheduledDue, advanceScheduled, disableScheduled,
  getRemindersDue, deleteReminderById,
  getGiveawaysDue,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';
import { endGiveawayAndAnnounce } from '../features/giveaways.js';
import { pollYoutube } from '../features/youtube.js';

const TICK_MS = 20_000;
const YT_EVERY_TICKS = 15; // ~5 minutes
let ytCounter = 0;

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

  // YouTube polling (every ~5 min)
  if (++ytCounter >= YT_EVERY_TICKS) {
    ytCounter = 0;
    await pollYoutube(client).catch((e) => console.error('YouTube poll error:', e.message));
  }
}

export function startScheduler(client) {
  setInterval(() => { tick(client).catch((e) => console.error('Scheduler tick error:', e)); }, TICK_MS).unref();
  console.log('Scheduler started (20s tick).');
}
