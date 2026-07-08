import {
  getScheduledDue, advanceScheduled, disableScheduled,
  getRemindersDue, deleteReminderById,
  getGiveawaysDue,
  getEventsToRemind, markEventReminded, getSignups,
  getRecurringDue, rolloverEvent, getEvent,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';
import { getPersonalization } from '../db/index.js';
import { buildMentions, applyMentions } from '../util/mentions.js';
import { endGiveawayAndAnnounce } from '../features/giveaways.js';
import { postEvent } from '../features/events.js';
import { pollSocial } from '../features/social.js';
import { updateStatChannels } from '../features/stats.js';
import { maybeDailyBackup } from '../features/backup.js';
import { reportError } from '../util/report.js';
import { getBotForGuild } from '../customBots/index.js';

const TICK_MS = 20_000;
const FEED_EVERY_TICKS = 15; // ~5 minutes (social incl. YouTube)
const STATS_EVERY_TICKS = 30; // ~10 minutes (channel-rename rate limits)
const BACKUP_EVERY_TICKS = 90; // ~30 minutes (actual backup only runs once/day)
const RECUR_GRACE_MS = 6 * 3600_000; // keep a recurring sheet up ~6h past start, then roll over
const DAY_MS = 86_400_000;
let feedCounter = 0;
let statsCounter = 0;
let backupCounter = BACKUP_EVERY_TICKS - 3; // check shortly after startup

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
}

async function tick(client) {
  const now = Date.now();
  // Helper: pick the right Client for outbound work in a given guild. If the
  // guild has a custom bot wired up, send from that one so it appears as their
  // bot's identity (and their bot's perms are what get checked).
  const botFor = (guildId) => getBotForGuild(guildId, client);

  // Scheduled messages
  for (const s of getScheduledDue(now)) {
    const channel = await resolveChannel(botFor(s.guild_id), s.channel_id);
    if (channel?.isTextBased()) {
      const payload = {};
      if (s.content) payload.content = s.content;
      const embed = s.embed ? buildEmbed(s.embed, undefined, getPersonalization(s.guild_id).embed_color ?? undefined) : null;
      if (embed) payload.embeds = [embed];
      applyMentions(payload, s.mentions);   // prepend role/@everyone pings + allowedMentions
      if (payload.content || payload.embeds) await channel.send(payload).catch(() => {});
    }
    // Advance to now + interval to avoid catch-up spam after downtime.
    if (s.type === 'interval' && s.interval_seconds) advanceScheduled(s.id, now + s.interval_seconds * 1000);
    else disableScheduled(s.id);
  }

  // Reminders
  for (const r of getRemindersDue(now)) {
    const channel = await resolveChannel(botFor(r.guild_id), r.channel_id);
    if (channel?.isTextBased()) {
      await channel.send(`⏰ <@${r.user_id}>, reminder: ${r.message || '(no message)'}`).catch(() => {});
    }
    deleteReminderById(r.id);
  }

  // Giveaways ending
  for (const g of getGiveawaysDue(now)) {
    await endGiveawayAndAnnounce(botFor(g.guild_id), g).catch((e) => console.error('Giveaway end error:', e.message));
  }

  // Event step reminders. Reminders fire up to 30 min past start so a deploy
  // gap during the reminder window doesn't permanently drop the ping.
  for (const event of getEventsToRemind(now)) {
    const channel = await resolveChannel(botFor(event.guild_id), event.channel_id);
    const signups = getSignups(event.id);
    // Ping the roles configured on the event PLUS everyone signed up. Send if
    // either is non-empty (a role ping is useful even with zero sign-ups yet).
    const rolePing = buildMentions(event.mentions);
    if (channel?.isTextBased() && (signups.length || rolePing)) {
      const userPings = signups.map((s) => `<@${s.user_id}>`).join(' ');
      const prefix = rolePing ? `${rolePing.text} ` : '';
      const tsec = Math.floor(event.start_at / 1000);
      const phrase = now >= event.start_at ? 'just started' : `starts <t:${tsec}:R>`;
      // Merge allowedMentions: the configured roles/everyone + the signed-up users.
      const allowed = rolePing ? { ...rolePing.allowedMentions } : { parse: [] };
      allowed.users = signups.map((s) => s.user_id).slice(0, 100);
      await channel.send({
        content: `${prefix}⏰ **${event.title}** ${phrase}${userPings ? ` — ${userPings}` : ''}`.slice(0, 2000),
        allowedMentions: allowed,
      }).catch(() => {});
    }
    markEventReminded(event.id);
  }

  // Recurring events: once an occurrence is ~6h past, advance to the next date,
  // clear sign-ups, and re-render the sheet in place for the next session.
  for (const ev of getRecurringDue(now - RECUR_GRACE_MS)) {
    let next = ev.start_at;
    const step = ev.recur_days * DAY_MS;
    while (next <= now) next += step;
    rolloverEvent(ev.id, next);
    const fresh = getEvent(ev.id);
    if (fresh?.message_id) await postEvent(botFor(fresh.guild_id), fresh).catch((e) => reportError(client, 'recur', e));
  }

  // Note: there used to be an auto-archive step here that marked one-off
  // events 'completed' 24h past start_at and re-rendered the embed with
  // locked buttons. Removed because the catch-up tick that fires ~2s after
  // every deploy was using it to kill buttons on any event older than a
  // day, which is exactly the "embeds stop working after we update" thing
  // the user kept hitting. If an event needs to be closed, the admin can
  // Cancel it from the dashboard.

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
  const runTick = () => tick(client).catch((e) => reportError(client, 'scheduler', e));
  setInterval(runTick, TICK_MS).unref();
  // Catch up on any time-sensitive work as soon as the bot is ready — a Railway
  // redeploy can land in the middle of a reminder window, and waiting 20s for
  // the first tick to catch up just makes the gap worse.
  const catchUp = () => setTimeout(runTick, 2000); // small delay so caches warm
  if (client.isReady()) catchUp();
  else client.once('ready', catchUp);
  console.log('Scheduler started (20s tick, catch-up on ready).');
}
