// Idempotent install of yt-dlp's self-contained Linux binary. Designed to be
// callable both as a standalone script (from `npm run build` / postinstall)
// AND as an importable function from the bot's startup. Either way ensures
// /app/yt-dlp + the @distube/yt-dlp plugin's bundled binary point at a
// Python-free standalone binary.

import { createWriteStream, existsSync, statSync } from 'node:fs';
import { chmod, mkdir, copyFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DEST = resolve(PROJECT_ROOT, 'yt-dlp');
// The @distube/yt-dlp plugin spawns its OWN bundled binary at this path,
// not the one on PATH. On Linux the plugin downloads the plain `yt-dlp`
// Python zipapp from GitHub releases, which fails at runtime with
// "python3: No such file or directory". We overwrite it with the
// self-contained yt-dlp_linux binary so the plugin's spawn() succeeds.
const PLUGIN_BIN = resolve(PROJECT_ROOT, 'node_modules', '@distube', 'yt-dlp', 'bin', 'yt-dlp');
const URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

// Heuristic: if the file is the self-contained PyInstaller binary it's >5MB
// (typically ~36MB). The Python zipapp from yt-dlp's release is ~2.5MB. We
// treat anything ≥5MB AND executable as "good standalone binary."
const looksLikeStandaloneBinary = (path) => {
  if (!existsSync(path)) return false;
  const s = statSync(path);
  return s.size > 5_000_000 && (s.mode & 0o111);
};

export async function ensureYtDlp() {
  if (process.platform !== 'linux') {
    console.log(`[install-yt-dlp] platform=${process.platform} — skipping (use 'winget install yt-dlp' on Windows / 'brew install yt-dlp' on macOS).`);
    return { ok: false, skipped: true };
  }

  // Step 1: get our standalone binary at /app/yt-dlp.
  if (looksLikeStandaloneBinary(DEST)) {
    const s = statSync(DEST);
    console.log(`[install-yt-dlp] /app/yt-dlp already standalone (${(s.size / 1_000_000).toFixed(1)} MB) — skipping download.`);
  } else {
    console.log(`[install-yt-dlp] downloading ${URL} → ${DEST}`);
    try {
      const res = await fetch(URL, { redirect: 'follow' });
      if (!res.ok) {
        console.error(`[install-yt-dlp] HTTP ${res.status} ${res.statusText}`);
        return { ok: false, error: `HTTP ${res.status}` };
      }
      await mkdir(PROJECT_ROOT, { recursive: true });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(DEST));
      await chmod(DEST, 0o755);
      const s = statSync(DEST);
      console.log(`[install-yt-dlp] ✓ /app/yt-dlp downloaded (${(s.size / 1_000_000).toFixed(1)} MB)`);
    } catch (err) {
      console.error('[install-yt-dlp] download FAILED:', err.message);
      return { ok: false, error: err.message };
    }
  }

  // Step 2: also overwrite the @distube/yt-dlp plugin's bundled binary.
  // The plugin spawns its own bundled binary by path, NOT through PATH lookup.
  if (existsSync(resolve(PROJECT_ROOT, 'node_modules', '@distube', 'yt-dlp'))) {
    if (looksLikeStandaloneBinary(PLUGIN_BIN)) {
      console.log(`[install-yt-dlp] plugin binary already standalone — skipping overwrite.`);
    } else {
      try {
        await mkdir(resolve(PLUGIN_BIN, '..'), { recursive: true });
        await copyFile(DEST, PLUGIN_BIN);
        await chmod(PLUGIN_BIN, 0o755);
        console.log(`[install-yt-dlp] ✓ overwrote plugin binary at ${PLUGIN_BIN}`);
      } catch (err) {
        console.warn(`[install-yt-dlp] could not overwrite plugin binary: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }
  } else {
    console.log('[install-yt-dlp] @distube/yt-dlp not installed — plugin overwrite skipped.');
  }

  return { ok: true };
}

// When invoked as a script (npm run build / postinstall), run immediately.
const isMain = fileURLToPath(import.meta.url) === resolve(process.argv[1] || '');
if (isMain) {
  await ensureYtDlp();
}
