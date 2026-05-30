// Fire-and-forget fan-out of sortie events to ReadyRoom's /ingest endpoint.
//
// Per-guild: each guild's READYROOM_INGEST_URL is stored in guild_config.readyroom_ingest_url
// (set by the squadron admin from the Ops Bot dashboard's DCS Server page). The bridge looks it
// up per call so different guilds can point at different ReadyRoom wings.
//
// Env-var fallback: READYROOM_INGEST_URL (single-tenant deploys without per-guild config).
//
// Design rules:
//   - Never throws — the local addSortie path must keep working even if ReadyRoom is down.
//   - Debounces ~1s per *destination URL* and batches into a single POST per URL.
//   - Logs at most once per minute so a dead URL doesn't spam the console.

import { getConfig } from '../db/index.js';

const ENV_URL = process.env.READYROOM_INGEST_URL || null;
const DEBOUNCE_MS = 1000;

// Map<url, { queue: sortie[], timer: NodeJS.Timeout|null }>
const buckets = new Map();
let lastLoggedAt = 0;

function logOnce(...args) {
  const now = Date.now();
  if (now - lastLoggedAt < 60_000) return;
  lastLoggedAt = now;
  console.warn('[readyroomBridge]', ...args);
}

function resolveUrl(guildId) {
  if (guildId) {
    try {
      const c = getConfig(guildId);
      if (c && c.readyroom_ingest_url) return c.readyroom_ingest_url;
    } catch { /* fall through to env */ }
  }
  return ENV_URL;
}

async function flush(url, bucket) {
  bucket.timer = null;
  if (!bucket.queue.length) return;
  const sorties = bucket.queue.splice(0, bucket.queue.length);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'sorties', source: 'dcs-ops-bot', sorties }),
    });
    if (!res.ok) logOnce(`POST ${url} -> ${res.status} for ${sorties.length} sortie(s)`);
  } catch (err) {
    logOnce('POST failed:', err.message);
  }
}

/**
 * Queue one sortie for forwarding to the ReadyRoom wing this guild is wired to.
 * Safe no-op if neither per-guild config nor the global env var is set.
 * @param {{pilot: string, airframe?: string|null, seconds?: number, started_at?: number}} sortie
 * @param {string|null} guildId  Discord guild ID — used to look up the per-guild ReadyRoom URL
 */
export function forwardSortie(sortie, guildId = null) {
  if (!sortie || !sortie.pilot) return;
  const url = resolveUrl(guildId);
  if (!url) return; // no destination configured for this guild
  let bucket = buckets.get(url);
  if (!bucket) { bucket = { queue: [], timer: null }; buckets.set(url, bucket); }
  bucket.queue.push({
    pilot: String(sortie.pilot),
    airframe: sortie.airframe ? String(sortie.airframe) : null,
    seconds: Number(sortie.seconds) || 0,
    started_at: Number.isFinite(sortie.started_at) ? sortie.started_at : null,
  });
  if (!bucket.timer) bucket.timer = setTimeout(() => flush(url, bucket), DEBOUNCE_MS);
}

// Exposed for tests + shutdown hooks.
export const _internal = {
  flushAll: async () => { for (const [url, bucket] of buckets) await flush(url, bucket); },
  queueLength: () => [...buckets.values()].reduce((n, b) => n + b.queue.length, 0),
};
