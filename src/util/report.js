// Resolve the bot owner and DM them about production errors (throttled), so
// failures don't just vanish into Railway logs nobody reads.

let ownerId = null;
let resolved = false;

// The owner is the Discord app owner (or OWNER_ID override). Cached after first lookup.
export async function resolveOwnerId(client) {
  if (resolved) return ownerId;
  resolved = true;
  if (process.env.OWNER_ID) { ownerId = process.env.OWNER_ID.trim(); return ownerId; }
  try {
    const app = await client.application.fetch();
    // Team-owned app → owner is a Team (use ownerId); user-owned → owner is a User.
    ownerId = app.owner?.ownerId || app.owner?.id || null;
  } catch (e) {
    console.error('Could not resolve app owner for error reports:', e.message);
  }
  return ownerId;
}

const recent = new Map(); // signature -> last-sent timestamp
const COOLDOWN_MS = 10 * 60_000; // don't DM the same error more than once per 10 min

// Log to console always; DM the owner at most once per 10 min per distinct error.
export async function reportError(client, context, err) {
  const detail = err?.stack || err?.message || String(err);
  console.error(`[${context}]`, detail);
  try {
    const id = await resolveOwnerId(client);
    if (!id) return;
    const sig = `${context}:${(err?.message || detail)}`.slice(0, 200);
    const now = Date.now();
    if (recent.has(sig) && now - recent.get(sig) < COOLDOWN_MS) return;
    recent.set(sig, now);
    if (recent.size > 200) for (const [k, t] of recent) if (now - t > COOLDOWN_MS) recent.delete(k);
    const owner = await client.users.fetch(id).catch(() => null);
    if (!owner) return;
    await owner.send(`⚠️ **DCS:OPT error** · \`${context}\`\n\`\`\`${detail.slice(0, 1800)}\`\`\``).catch(() => {});
  } catch { /* error reporting must never throw */ }
}
