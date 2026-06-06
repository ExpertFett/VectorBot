// Analytics aggregations. All queries read existing tables — no new schema —
// so adding analytics has zero impact on the write path. Buckets are computed
// in JS rather than via SQL date math because node:sqlite has no date funcs.

import db from '../db/index.js';

const DAY_MS = 86_400_000;
const dayKey = (ts) => Math.floor(ts / DAY_MS); // integer epoch-day, easy to compare

const countSince = (table, guildId, since, where = '') => {
  const sql = `SELECT COUNT(*) AS n FROM ${table} WHERE guild_id = ? AND created_at >= ?${where ? ' AND ' + where : ''}`;
  return db.prepare(sql).get(guildId, since).n;
};

// Build a daily sparkline series over the last N days. Returns an array of
// { day: epochDay, count: number } from oldest to newest, with zero-fills
// for days that had no events.
function dailySeries(table, guildId, days, extraWhere = '') {
  const now = Date.now();
  const since = now - days * DAY_MS;
  const rows = db.prepare(
    `SELECT created_at FROM ${table} WHERE guild_id = ? AND created_at >= ?${extraWhere ? ' AND ' + extraWhere : ''}`,
  ).all(guildId, since);
  const buckets = new Map();
  for (const r of rows) {
    const k = dayKey(r.created_at);
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  const startDay = dayKey(since);
  const endDay = dayKey(now);
  const out = [];
  for (let d = startDay; d <= endDay; d++) {
    out.push({ day: d, count: buckets.get(d) || 0 });
  }
  return out;
}

export function computeAnalytics(guildId) {
  const now = Date.now();
  const d7 = now - 7 * DAY_MS;
  const d30 = now - 30 * DAY_MS;
  const d90 = now - 90 * DAY_MS;

  // --- Growth ---
  const joins7 = countSince('welcome_log', guildId, d7, "kind = 'welcome' AND test = 0");
  const joins30 = countSince('welcome_log', guildId, d30, "kind = 'welcome' AND test = 0");
  const leaves7 = countSince('welcome_log', guildId, d7, "kind = 'goodbye' AND test = 0");
  const leaves30 = countSince('welcome_log', guildId, d30, "kind = 'goodbye' AND test = 0");
  const joinSeries = dailySeries('welcome_log', guildId, 30, "kind = 'welcome' AND test = 0");
  const leaveSeries = dailySeries('welcome_log', guildId, 30, "kind = 'goodbye' AND test = 0");

  // --- Events ---
  const eventsCreated30 = countSince('events', guildId, d30);
  const eventsCompleted30 = db.prepare(
    "SELECT COUNT(*) AS n FROM events WHERE guild_id = ? AND status = 'completed' AND created_at >= ?",
  ).get(guildId, d30).n;
  const upcoming = db.prepare(
    "SELECT COUNT(*) AS n FROM events WHERE guild_id = ? AND status = 'scheduled' AND start_at > ?",
  ).get(guildId, now).n;
  // Fill rate over completed events in the last 30d: sum filled / sum capacity.
  // Each row in events.roles is a flight role with an optional limit (0 = no cap).
  // Sign-ups are joined per role_label; we cap the per-role count at the limit
  // so over-signups (waitlist) don't push the rate above 100%.
  const completedRows = db.prepare(
    "SELECT id, roles FROM events WHERE guild_id = ? AND status = 'completed' AND created_at >= ?",
  ).all(guildId, d30);
  const signupsByRole = db.prepare(
    'SELECT role_label, COUNT(*) AS n FROM event_signups WHERE event_id = ? GROUP BY role_label',
  );
  let totalCap = 0;
  let totalFilled = 0;
  let eventsWithCap = 0;
  for (const ev of completedRows) {
    let roles;
    try { roles = JSON.parse(ev.roles) || []; } catch { roles = []; }
    const rowCap = roles.reduce((n, r) => n + (Number(r.limit) || 0), 0);
    if (!rowCap) continue; // skip uncapped events from fill-rate calc
    eventsWithCap++;
    totalCap += rowCap;
    const counts = new Map(signupsByRole.all(ev.id).map((r) => [r.role_label, r.n]));
    for (const role of roles) {
      const lim = Number(role.limit) || 0;
      if (!lim) continue;
      totalFilled += Math.min(counts.get(role.label) || 0, lim);
    }
  }
  const fillRate = totalCap ? totalFilled / totalCap : null;

  // --- DCS Ops ---
  const sorties7 = countSince('sorties', guildId, d7);
  const sortieTime7 = db.prepare(
    'SELECT COALESCE(SUM(seconds), 0) AS s FROM sorties WHERE guild_id = ? AND created_at >= ?',
  ).get(guildId, d7).s;
  const traps7 = countSince('traps', guildId, d7);
  const trapAvg7 = db.prepare(
    'SELECT AVG(points) AS p FROM traps WHERE guild_id = ? AND created_at >= ?',
  ).get(guildId, d7).p;
  const bombs7 = countSince('bomb_scores', guildId, d7);
  const bombAvg7 = db.prepare(
    'SELECT AVG(distance) AS d FROM bomb_scores WHERE guild_id = ? AND created_at >= ?',
  ).get(guildId, d7).d;

  // --- Applications ---
  const apps30 = countSince('applications', guildId, d30);
  const appsPending = db.prepare(
    "SELECT COUNT(*) AS n FROM applications WHERE guild_id = ? AND status = 'pending'",
  ).get(guildId).n;
  const appsApproved30 = db.prepare(
    "SELECT COUNT(*) AS n FROM applications WHERE guild_id = ? AND status = 'approved' AND created_at >= ?",
  ).get(guildId, d30).n;
  const appsRejected30 = db.prepare(
    "SELECT COUNT(*) AS n FROM applications WHERE guild_id = ? AND status = 'rejected' AND created_at >= ?",
  ).get(guildId, d30).n;
  const appsDecided30 = appsApproved30 + appsRejected30;
  const approvalRate = appsDecided30 ? appsApproved30 / appsDecided30 : null;

  // --- Tickets ---
  const ticketsOpened30 = countSince('tickets', guildId, d30);
  const ticketsOpenNow = db.prepare(
    "SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open'",
  ).get(guildId).n;
  const ticketsClosed30 = db.prepare(
    "SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'closed' AND created_at >= ?",
  ).get(guildId, d30).n;

  // --- Moderation ---
  const modActions30 = countSince('mod_log', guildId, d30);
  const modBreakdown = db.prepare(
    'SELECT action, COUNT(*) AS n FROM mod_log WHERE guild_id = ? AND created_at >= ? GROUP BY action ORDER BY n DESC',
  ).all(guildId, d30);

  // --- Invites (top 5 inviters all-time) ---
  const topInviters = db.prepare(
    'SELECT inviter_id, joins FROM invite_counts WHERE guild_id = ? ORDER BY joins DESC LIMIT 5',
  ).all(guildId).filter((r) => r.joins > 0);

  return {
    growth: {
      joins: { d7: joins7, d30: joins30 },
      leaves: { d7: leaves7, d30: leaves30 },
      net: { d7: joins7 - leaves7, d30: joins30 - leaves30 },
      joinSeries,
      leaveSeries,
    },
    events: {
      created30: eventsCreated30,
      completed30: eventsCompleted30,
      upcoming,
      fillRate,                                                 // 0..1 or null
      eventsWithCap30: eventsWithCap,
      avgFilledPerCappedEvent: eventsWithCap ? totalFilled / eventsWithCap : null,
    },
    dcs: {
      sorties7,
      sortieHours7: sortieTime7 / 3600,
      traps7,
      trapAvg7: trapAvg7 ?? null,
      bombs7,
      bombAvgMeters7: bombAvg7 ?? null,
    },
    applications: {
      total30: apps30,
      pending: appsPending,
      approved30: appsApproved30,
      rejected30: appsRejected30,
      approvalRate,
    },
    tickets: {
      opened30: ticketsOpened30,
      closed30: ticketsClosed30,
      openNow: ticketsOpenNow,
    },
    moderation: {
      actions30: modActions30,
      breakdown: modBreakdown,
    },
    invites: { topInviters },
    generatedAt: now,
  };
}
