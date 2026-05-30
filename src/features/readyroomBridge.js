// Fire-and-forget fan-out of sortie events to a ReadyRoom wing's /ingest endpoint.
// Reads READYROOM_INGEST_URL from env (set on Railway). The full URL includes the
// wing's ingest token, e.g. https://dcsoptreadyroom.up.railway.app/ingest/<token>.
//
// Design rules:
//   - Never throw — the local addSortie path must keep working even if ReadyRoom
//     is down or the env var is missing.
//   - Debounce by ~1s and batch in a single POST so a busy server doesn't generate
//     a request per landing.
//   - Logs at most once per failure burst (so a dead URL doesn't spam the console).

const URL = process.env.READYROOM_INGEST_URL || null;
const DEBOUNCE_MS = 1000;

let queue = [];
let timer = null;
let lastLoggedAt = 0;

function logOnce(...args) {
  const now = Date.now();
  if (now - lastLoggedAt < 60_000) return; // at most once a minute
  lastLoggedAt = now;
  console.warn('[readyroomBridge]', ...args);
}

async function flush() {
  timer = null;
  if (!URL || !queue.length) return;
  const sorties = queue.splice(0, queue.length);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'sorties', source: 'dcs-ops-bot', sorties }),
    });
    if (!res.ok) logOnce(`ingest returned ${res.status} for ${sorties.length} sortie(s)`);
  } catch (err) {
    logOnce('ingest POST failed:', err.message);
  }
}

/**
 * Queue one sortie for forwarding. Safe no-op if READYROOM_INGEST_URL is unset.
 * @param {{pilot: string, airframe?: string|null, seconds?: number, started_at?: number}} sortie
 */
export function forwardSortie(sortie) {
  if (!URL || !sortie || !sortie.pilot) return;
  queue.push({
    pilot: String(sortie.pilot),
    airframe: sortie.airframe ? String(sortie.airframe) : null,
    seconds: Number(sortie.seconds) || 0,
    started_at: Number.isFinite(sortie.started_at) ? sortie.started_at : null,
  });
  if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
}

// Expose for tests / shutdown hooks.
export const _internal = { flush, queueLength: () => queue.length };
