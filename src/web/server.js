import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { SqliteSessionStore } from './sessionStore.js';
import { authRouter } from './auth.js';
import { apiRouter } from './api.js';
import { ingestRouter } from './ingest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', '..', 'dashboard', 'dist');

export function startWebServer(client) {
  const app = express();
  const isProd =
    process.env.NODE_ENV === 'production' || (process.env.BASE_URL || '').startsWith('https');

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET not set — using an insecure dev fallback. Set it in production.');
  }
  app.use(session({
    name: 'vector.sid',
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }));

  app.use('/auth', authRouter);
  app.use('/api', apiRouter(client));
  app.use('/ingest', ingestRouter(client)); // public, token-authed DCS hook endpoint
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
