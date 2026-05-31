import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import db from '../db/index.js';
import { resolveOwnerId } from '../util/report.js';

// Mirror the path resolution in src/db/index.js so backups land beside the DB
// (on the Railway volume if one is mounted).
const volumeMount = (process.env.RAILWAY_VOLUME_MOUNT_PATH
  || process.env.RAILWAY_PERSISTENT_VOLUME_PATH
  || '').replace(/\/$/, '');
const dbPath = process.env.DB_PATH
  || (volumeMount ? `${volumeMount}/bot.db` : './data/bot.db');
const backupDir = join(dirname(dbPath), 'backups');
const KEEP = 14;                       // rotate: keep the newest N snapshots
const MIN_AGE_MS = 20 * 3600_000;      // consider a new daily backup "due" after 20h

const snapFiles = () => (existsSync(backupDir)
  ? readdirSync(backupDir).filter((f) => f.startsWith('bot-') && f.endsWith('.db'))
    .map((f) => ({ path: join(backupDir, f), t: statSync(join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  : []);

export function latestSnapshot() { return snapFiles()[0]?.path || null; }

// Write a consistent single-file copy of the DB. VACUUM INTO is safe on a live
// WAL database and produces a clean, fully-checkpointed snapshot.
export function createSnapshot() {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(backupDir, `bot-${stamp}.db`);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  for (const { path } of snapFiles().slice(KEEP)) { try { unlinkSync(path); } catch { /* ignore */ } }
  return out;
}

// Snapshot locally (on the volume) and DM the owner an off-box copy.
export async function runBackup(client) {
  const file = createSnapshot();
  try {
    const id = await resolveOwnerId(client);
    const owner = id ? await client.users.fetch(id).catch(() => null) : null;
    if (owner) {
      await owner.send({
        content: `🗄️ DCS:OPT database backup · ${new Date().toUTCString()}`,
        files: [{ attachment: file, name: basename(file) }],
      }).catch(() => {});
    }
  } catch (e) {
    console.error('Backup owner DM failed:', e.message);
  }
  return file;
}

// Run a backup only if the most recent snapshot is older than ~a day. Uses file
// mtime on the persistent volume, so frequent redeploys don't trigger extra backups.
export async function maybeDailyBackup(client) {
  const latest = latestSnapshot();
  if (latest && Date.now() - statSync(latest).mtimeMs < MIN_AGE_MS) return null;
  return runBackup(client);
}
