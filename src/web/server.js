import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { SqliteSessionStore } from './sessionStore.js';
import { authRouter } from './auth.js';
import { apiRouter } from './api.js';
import { ingestRouter } from './ingest.js';
import { integrationsRouter } from './integrations.js';
import db from '../db/index.js';

// Resolve a session secret that's STABLE across deploys, so the same cookies
// keep validating after a Railway restart even if SESSION_SECRET isn't set.
// Priority:
//   1. SESSION_SECRET env var (explicit, best practice — wins always).
//   2. A random 64-byte secret persisted into the DB on first boot. Survives
//      every restart as long as the volume is attached.
//   3. (impossible path) Hardcoded dev fallback — only hit if the DB itself
//      can't be written to, which would already break everything else.
function resolveSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    db.exec("CREATE TABLE IF NOT EXISTS app_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    const row = db.prepare("SELECT v FROM app_kv WHERE k = 'session_secret'").get();
    if (row?.v) {
      console.log('[session] reusing persisted session secret from DB (set SESSION_SECRET env var to override)');
      return row.v;
    }
    const fresh = crypto.randomBytes(64).toString('hex');
    db.prepare("INSERT OR REPLACE INTO app_kv (k, v) VALUES ('session_secret', ?)").run(fresh);
    console.log('[session] generated + persisted new session secret to DB');
    return fresh;
  } catch (err) {
    console.warn('[session] could not persist secret to DB, falling back to dev string:', err.message);
    return 'dev-insecure-secret-change-me';
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', '..', 'dashboard', 'dist');

export function startWebServer(client) {
  const app = express();
  const isProd =
    process.env.NODE_ENV === 'production' || (process.env.BASE_URL || '').startsWith('https');

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  const secret = resolveSessionSecret();
  if (!process.env.SESSION_SECRET) {
    console.warn(
      '[session] SESSION_SECRET env var not set — using a secret persisted in the DB instead. ' +
      'Sessions WILL survive restarts as long as the volume is attached. ' +
      'Setting SESSION_SECRET in Railway Variables is still recommended for clarity.'
    );
  }
  app.use(session({
    name: 'vector.sid',
    secret,
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    // Rolling: refresh the cookie's expire on every response, so admins who
    // actually use the dashboard stay logged in indefinitely. Without this the
    // cookie expires 30 days after LOGIN regardless of activity, which is what
    // made it feel like "every redeploy logs me out."
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  }));

  app.use('/auth', authRouter);
  app.use('/api', apiRouter(client));
  app.use('/ingest', ingestRouter(client)); // public, token-authed DCS hook endpoint
  app.use('/integrations', integrationsRouter(client)); // public, bearer-token-authed cross-app calls (ReadyRoom)
  app.get('/healthz', (req, res) => res.json({ ok: true, bot: client.isReady?.() ?? false }));

  // Serve the built dashboard (if present) with SPA fallback.
  if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(join(DIST_DIR, 'index.html'));
    });
  } else {
    app.get('/', (req, res) =>
      res.type('html').send(
        '<h1>VectorBot</h1><p>Dashboard not built yet. Run <code>npm run build</code>.</p>'
      ));
  }

  app.use((err, req, res, next) => {
    console.error('Web error:', err);
    res.status(500).json({ error: 'server_error' });
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Dashboard listening on port ${port}.`));
}
