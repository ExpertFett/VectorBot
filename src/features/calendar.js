// Wall calendar (thin relay). Ready Room OWNS the calendar now: it renders the
// month-grid PNG from its own events at /share/:token/calendar.png. This module
// just fetches that image and keeps it as ONE pinned message in a channel,
// refreshed nightly (and on /calendar refresh). No rendering happens here.

import {
  getConfig, setCalendarMessage, setCalendarLastRun, getCalendarGuilds,
} from '../db/index.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');

export function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
function tzParts(ms, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day };
}
function monthInTz(nowMs, tz, offset = 0) {
  const p = tzParts(nowMs, tz);
  let year = p.y, month = p.m - 1 + offset;
  while (month < 0) { month += 12; year--; }
  while (month > 11) { month -= 12; year++; }
  return { year, month };
}

function parseSource(cfg) {
  let s = {};
  try { s = cfg.calendar_source ? JSON.parse(cfg.calendar_source) : {}; } catch { /* ignore */ }
  return {
    source_url: s.source_url || null,
    tz: s.tz && isValidTz(s.tz) ? s.tz : 'America/Denver',
    title: s.title || null,
    event_list: !!s.event_list,   // append a Discord-timestamp event list under the image
  };
}

// Resolve the Ready Room base + wing token from either an explicit share/ingest
// URL the admin pasted, or the guild's stored ingest URL (.../ingest/<token>).
function deriveShare(cfg, source) {
  for (const c of [source.source_url, cfg.readyroom_ingest_url].filter(Boolean)) {
    const m = String(c).match(/^(.*)\/(?:share|ingest)\/([^/?#]+)/);
    if (m) return { root: m[1], token: m[2] };
  }
  return null;
}
function calendarPngUrl(cfg, source, offset) {
  const d = deriveShare(cfg, source);
  if (!d) return null;
  const q = new URLSearchParams({ tz: source.tz, month: String(offset) });
  if (source.title) q.set('title', source.title);
  return `${d.root}/share/${d.token}/calendar.png?${q.toString()}`;
}

// Optional text companion under the pinned image: this month's events as Discord
// <t:…> timestamps, which each viewer sees in THEIR OWN local time (an image
// can't do that — its zone is baked in at render). Fetches Ready Room's JSON
// events feed and keeps only events whose local day falls in the shown month.
// Best-effort: returns '' on any failure so it never blocks the image post.
async function buildEventListText(cfg, source, year, month) {
  const d = deriveShare(cfg, source);
  if (!d) return '';
  const from = Date.UTC(year, month, 1) - 2 * 86_400_000;
  const to = Date.UTC(year, month + 1, 1) + 2 * 86_400_000;
  let events = [];
  try {
    const res = await fetch(`${d.root}/share/${d.token}/events?from=${from}&to=${to}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return '';
    events = (await res.json()).events || [];
  } catch { return ''; }
  const rows = events
    .filter((e) => { const p = tzParts(e.start_at, source.tz); return p.y === year && p.m === month + 1; })
    .sort((a, b) => a.start_at - b.start_at)
    .slice(0, 20)
    .map((e) => {
      const secs = Math.floor(e.start_at / 1000);
      const star = e.kind === 'extra_credit' ? '⭐ ' : '';
      return `${star}<t:${secs}:f> — **${String(e.title || 'Event').slice(0, 80)}**`;
    });
  if (!rows.length) return '';
  return `\n\n**Events this month** · times shown in your local zone\n${rows.join('\n')}`;
}

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
}

// Fetch Ready Room's rendered calendar PNG and post-or-edit-and-pin it. Throws
// on fetch failure so the command can surface the reason.
export async function regenerateCalendar(client, guildId, { monthOffset = 0 } = {}) {
  const cfg = getConfig(guildId);
  if (!cfg.calendar_channel_id) return { ok: false, reason: 'no_channel' };
  const source = parseSource(cfg);

  const url = calendarPngUrl(cfg, source, monthOffset);
  if (!url) throw new Error('Ready Room isn’t linked — wire the wing ingest URL first, or paste a /share/<token> URL as source_url.');
  const res = await fetch(url, { headers: { accept: 'image/png' } });
  if (!res.ok) throw new Error(`Ready Room returned ${res.status} rendering the calendar — check the wing token / URL.`);
  const png = Buffer.from(await res.arrayBuffer());

  const channel = await resolveChannel(client, cfg.calendar_channel_id);
  if (!channel?.isTextBased()) return { ok: false, reason: 'channel_gone' };

  const { year, month } = monthInTz(Date.now(), source.tz, monthOffset);
  const file = { attachment: png, name: `calendar-${year}-${pad2(month + 1)}.png` };
  let content = `📅 **${MONTHS[month]} ${year}**${source.title ? ` — ${source.title}` : ''}`;
  if (source.event_list) content += await buildEventListText(cfg, source, year, month);
  content = content.slice(0, 2000);   // Discord message content hard limit

  if (cfg.calendar_message_id) {
    const msg = await channel.messages.fetch(cfg.calendar_message_id).catch(() => null);
    if (msg) {
      await msg.edit({ content, files: [file] }).catch(() => {});
      setCalendarLastRun(guildId, Date.now());
      return { ok: true, edited: true };
    }
  }
  const sent = await channel.send({ content, files: [file] });
  setCalendarMessage(guildId, channel.id, sent.id);
  await sent.pin().catch(() => {}); // needs Manage Messages; harmless if it fails
  setCalendarLastRun(guildId, Date.now());
  return { ok: true, edited: false };
}

// Nightly gate: refresh a guild's calendar once the local day rolls over, or if
// it's gone stale (>6h), so newly-added events show up reasonably soon.
export async function runDueCalendars(client) {
  const now = Date.now();
  for (const g of getCalendarGuilds()) {
    let src = {};
    try { src = g.calendar_source ? JSON.parse(g.calendar_source) : {}; } catch { /* ignore */ }
    const tz = src.tz && isValidTz(src.tz) ? src.tz : 'America/Denver';
    const last = g.calendar_last_run || 0;
    const a = tzParts(last, tz), b = tzParts(now, tz);
    const dayChanged = !last || a.y !== b.y || a.m !== b.m || a.d !== b.d;
    if (!(dayChanged || now - last >= 6 * 3_600_000)) continue;
    try { await regenerateCalendar(client, g.guild_id); }
    catch (e) { console.error(`[calendar] regen failed for ${g.guild_id}:`, e.message); }
  }
}
