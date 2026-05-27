import {
  getScheduledDue, advanceScheduled, disableScheduled,
  getRemindersDue, deleteReminderById,
  getGiveawaysDue,
  getEventsToRemind, markEventReminded, getSignups,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';
import { getPersonalization } from '../db/index.js';
import { endGiveawayAndAnnounce } from '../features/giveaways.js';
import { pollSocial } from '../features/social.js';
import { updateStatChannels } from '../features/stats.js';
import { maybeDailyBackup } from '../features/backup.js';
import { reportError } from '../util/report.js';

const TICK_MS = 20_000;
const FEED_EVERY_TICKS = 15; // ~5 minutes (social incl. YouTube)
const STATS_EVERY_TICKS = 30; // ~10 minutes (channel-rename rate limits)
const BACKUP_EVERY_TICKS = 90; // ~30 minutes (actual backup only runs once/day)
let feedCounter = 0;
let statsCounter = 0;
let backupCounter = BACKUP_EVERY_TICKS - 3; // check shortly after startup

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
      const embed = s.embed ? buildEmbed(s.embed, undefined, getPersonalization(s.guild_id).embed_color ?? undefined) : null;
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

  // Event step reminders
  for (const event of getEventsToRemind(now)) {
    const channel = await resolveChannel(client, event.channel_id);
    const signups = getSignups(event.id);
    if (channel?.isTextBased() && signups.length) {
      const pings = signups.map((s) => `<@${s.user_id}>`).join(' ');
      await channel.send(`⏰ **${event.title}** starts <t:${Math.floor(event.start_at / 1000)}:R> — ${pings}`).catch(() => {});
    }
    markEventReminded(event.id);
  }

  // Feeds: social alerts incl. YouTube (every ~5 min)
  if (++feedCounter >= FEED_EVERY_TICKS) {
    feedCounter = 0;
    await pollSocial(client).catch((e) => console.error('Social poll error:', e.message));
  }

  // Stats counter channels (every ~10 min)
  if (++statsCounter >= STATS_EVERY_TICKS) {
    statsCounter = 0;
    await updateStatChannels(client).catch((e) => console.error('Stats update error:', e.message));
  }

  // Daily database backup (checked ~every 30 min; runs at most once per day)
  if (++backupCounter >= BACKUP_EVERY_TICKS) {
    backupCounter = 0;
    await maybeDailyBackup(client).catch((e) => reportError(client, 'backup', e));
  }
}

export function startScheduler(client) {
  setInterval(() => { tick(client).catch((e) => reportError(client, 'scheduler', e)); }, TICK_MS).unref();
  console.log('Scheduler started (20s tick).');
}
