// Builds the "drop into your Hooks folder" installer zip for a guild on demand.
//
// The hook template ships with a placeholder URL line. We substitute the
// guild's real ingest URL + token at request time, so the user downloads a
// pre-configured zip and doesn't have to edit anything by hand. The zip
// also includes the VBS launcher and a short README.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_DIR = join(__dirname, '..', '..', 'dcs-hook');

// Read source files once at boot — they don't change between requests.
const HOOK_TEMPLATE    = readFileSync(join(HOOK_DIR, 'dcsopt_hook.lua'), 'utf8');
const MISSION_TEMPLATE = readFileSync(join(HOOK_DIR, 'dcsopt_mission.lua'), 'utf8');
const DAEMON_TEMPLATE  = readFileSync(join(HOOK_DIR, 'dcsopt_daemon.vbs'), 'utf8');

// Single source of truth for "the latest hook version" — parsed straight out
// of the .lua so bumping DCSOPT.VERSION there is the only thing to update.
// A server reporting a lower version gets an upgrade nudge on the dashboard.
export const CURRENT_HOOK_VERSION =
  (HOOK_TEMPLATE.match(/DCSOPT\.VERSION\s*=\s*"([^"]+)"/) || [])[1] || '0.0.0';

function readme(ingestUrl) {
  return [
    '== DCS:OPT OPS Bot — DCS Server Installer ==',
    '',
    'CONTENTS:',
    '  dcsopt_hook.lua      — main GameGUI hook (pre-configured with your URL)',
    '  dcsopt_mission.lua   — mission-script side (captures kills/traps/bombs)',
    '  dcsopt_daemon.vbs    — background poster (windowless, exits with DCS)',
    '',
    'INSTALL:',
    '  1. Open your DCS Saved Games folder:',
    '       %USERPROFILE%\\Saved Games',
    '     (paste that into File Explorer\'s address bar)',
    '  2. Find the folder for your DCS variant (DCS, DCS.openbeta, DCS.server).',
    '  3. Go into that folder, then into "Scripts" then "Hooks" (create them if missing).',
    '  4. Drop ALL THREE files from this zip into that Hooks folder.',
    '     (If you have files from an older install — vectorbot*.* or other',
    '      dcsopt_* files — delete those first. The new hook also cleans up',
    '      leftovers automatically on first run.)',
    '  5. Restart your DCS server / DCS.',
    '',
    'WHAT TO EXPECT:',
    '  One brief minimized window flash when a mission loads — that is the',
    '  background poster starting. After that: nothing visible, ever.',
    '',
    'VERIFY:',
    '  Check the dashboard\'s "DCS Server" page — within ~60 seconds of restart,',
    '  the status should turn green and show "Online" with the current mission.',
    '',
    'PRE-CONFIGURED URL (already baked into dcsopt_hook.lua — no editing needed):',
    '  ' + ingestUrl,
    '',
    'TROUBLESHOOTING:',
    '  - Check Saved Games\\<your variant>\\Logs\\dcs.log',
    '  - Search the log for "DCSOPT" — you should see:',
    '      DCSOPT: hook loaded (v2 daemon architecture)',
    '      DCSOPT: mission tracker installed (installed)',
    '      DCSOPT: posting daemon launched',
    '  - "dcsopt_daemon.vbs missing" in the log = you only dropped the .lua',
    '    files. All THREE files go in the same Hooks folder.',
    '  - If you only see "hook loaded", you missed dcsopt_mission.lua.',
    '',
  ].join('\r\n');
}

export function buildInstallerZip(ingestUrl) {
  // Replace the placeholder URL line in the hook template with the real one.
  const hookConfigured = HOOK_TEMPLATE.replace(
    /url\s*=\s*"https:\/\/CHANGE-ME[^"]*"/,
    `url               = ${JSON.stringify(ingestUrl)}`,
  );
  const zipped = zipSync({
    'dcsopt_hook.lua':    strToU8(hookConfigured),
    'dcsopt_mission.lua': strToU8(MISSION_TEMPLATE),
    'dcsopt_daemon.vbs':  strToU8(DAEMON_TEMPLATE),
    'README.txt':         strToU8(readme(ingestUrl)),
  }, { level: 6 });
  return Buffer.from(zipped);
}

export function hookTemplatesPresent() {
  return existsSync(join(HOOK_DIR, 'dcsopt_hook.lua'))
      && existsSync(join(HOOK_DIR, 'dcsopt_mission.lua'));
}
