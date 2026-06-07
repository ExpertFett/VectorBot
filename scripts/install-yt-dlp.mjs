// Post-install hook: download yt-dlp's self-contained Linux binary so the
// music engine can extract YouTube audio without depending on system Python.
//
// Runs as part of `npm ci` / `npm install` during the Railway build phase.
// On non-Linux platforms (e.g. local dev on Windows / macOS) we skip and let
// the developer install yt-dlp themselves (e.g. `winget install yt-dlp`).
// The binary is dropped at `<projectRoot>/yt-dlp` and the start command
// prepends the project root to PATH so the @distube/yt-dlp plugin finds it.

import { createWriteStream, existsSync, statSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const DEST = resolve(PROJECT_ROOT, 'yt-dlp');
const URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

if (process.platform !== 'linux') {
  console.log(`[install-yt-dlp] platform=${process.platform} — skipping. ` +
    `Install yt-dlp manually if you need /play locally (winget install yt-dlp on Windows, brew install yt-dlp on macOS).`);
  process.exit(0);
}

// If a previous build already dropped the binary and it's executable, skip the
// re-download. Saves ~30MB of bandwidth on Railway's incremental builds.
if (existsSync(DEST)) {
  const s = statSync(DEST);
  if (s.size > 1_000_000 && (s.mode & 0o111)) {
    console.log(`[install-yt-dlp] binary already present at ${DEST} (${(s.size / 1_000_000).toFixed(1)} MB) — skipping download.`);
    process.exit(0);
  }
}

console.log(`[install-yt-dlp] downloading ${URL} → ${DEST}`);
try {
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`[install-yt-dlp] HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  await mkdir(PROJECT_ROOT, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(DEST));
  await chmod(DEST, 0o755);
  const s = statSync(DEST);
  console.log(`[install-yt-dlp] ✓ binary ready (${(s.size / 1_000_000).toFixed(1)} MB) — chmod 755`);
} catch (err) {
  console.error('[install-yt-dlp] FAILED:', err.message);
  // Don't fail the install — let the rest of the bot work and surface the
  // missing-binary issue at /play time instead. (Music is one feature of many.)
  process.exit(0);
}
