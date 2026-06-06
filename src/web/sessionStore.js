import session from 'express-session';
import db from '../db/index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    sess   TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
`);

const getStmt = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
const upsertStmt = db.prepare(`
  INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
  ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
`);
const delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
const touchStmt = db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
const sweepStmt = db.prepare('DELETE FROM sessions WHERE expire < ?');

const DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const expiryOf = (sess) => {
  // sess.cookie.expires can be a Date, a Date string, undefined, or — under
  // some express-session paths — null. new Date(null) parses to epoch 0, which
  // would make the session look already-expired and silently drop the user.
  const raw = sess?.cookie?.expires;
  if (raw) {
    const ms = new Date(raw).getTime();
    if (Number.isFinite(ms) && ms > Date.now()) return ms;
  }
  return Date.now() + DEFAULT_TTL;
};

// Boot-time visibility — one log line at startup so the deploy log shows
// whether sessions were inherited from the volume or started empty. If this
// reads "0 active sessions" after every deploy, the DB file isn't on a volume
// and login state can't survive a restart.
try {
  const total = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  const active = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expire > ?').get(Date.now()).n;
  console.log(`[session] sqlite session store ready · ${active} active / ${total} total rows survived this restart`);
} catch (err) {
  console.warn('[session] startup probe failed:', err.message);
}

export class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = getStmt.get(sid);
      if (!row) {
        if (process.env.SESSION_DEBUG) console.log(`[session] get(${sid.slice(0, 8)}) → MISS (no row)`);
        return cb(null, null);
      }
      if (row.expire < Date.now()) {
        if (process.env.SESSION_DEBUG) console.log(`[session] get(${sid.slice(0, 8)}) → MISS (expired ${Math.round((Date.now() - row.expire) / 1000)}s ago)`);
        delStmt.run(sid); return cb(null, null);
      }
      if (process.env.SESSION_DEBUG) console.log(`[session] get(${sid.slice(0, 8)}) → HIT`);
      cb(null, JSON.parse(row.sess));
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      upsertStmt.run(sid, JSON.stringify(sess), expiryOf(sess));
      if (process.env.SESSION_DEBUG) console.log(`[session] set(${sid.slice(0, 8)}) ← expire=${new Date(expiryOf(sess)).toISOString()}`);
      cb?.(null);
    } catch (err) { console.error('[session] set failed:', err.message); cb?.(err); }
  }

  destroy(sid, cb) {
    try { delStmt.run(sid); cb?.(null); } catch (err) { cb?.(err); }
  }

  touch(sid, sess, cb) {
    try { touchStmt.run(expiryOf(sess), sid); cb?.(null); } catch (err) { cb?.(err); }
  }
}

// Periodically clear expired rows.
setInterval(() => { try { sweepStmt.run(Date.now()); } catch { /* ignore */ } }, 60 * 60 * 1000).unref();
