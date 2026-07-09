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
const INSTALL_CMD      = readFileSync(join(HOOK_DIR, 'Install.cmd'), 'utf8');
const INSTALL_PS1      = readFileSync(join(HOOK_DIR, 'install.ps1'), 'utf8');

// Single source of truth for "the latest hook version" — parsed straight out
// of the .lua so bumping DCSOPT.VERSION there is the only thing to update.
// A server reporting a lower version gets an upgrade nudge on the dashboard.
export const CURRENT_HOOK_VERSION =
  (HOOK_TEMPLATE.match(/DCSOPT\.VERSION\s*=\s*"([^"]+)"/) || [])[1] || '0.0.0';

function readme(ingestUrl) {
  return [
    '== DCS:OPT OPS Bot - DCS Server Installer ==',
    '',
    '**** EASIEST WAY: just double-click  Install.cmd  ****',
    '     It finds your DCS folder and installs everything for you.',
    '     Nothing to configure - your server URL is already baked in.',
    '',
    'CONTENTS:',
    '  Install.cmd          - double-click this to auto-install (recommended)',
    '  install.ps1          - the installer logic Install.cmd runs',
    '  dcsopt_hook.lua      - main GameGUI hook (pre-configured with your URL)',
    '  dcsopt_mission.lua   - mission-script side (captures kills/traps/bombs)',
    '  dcsopt_daemon.vbs    - background poster (windowless, exits with DCS)',
    '',
    'IF WINDOWS WARNS about Install.cmd (SmartScreen):',
    '  Click "More info" -> "Run anyway". It is unsigned, like most community',
    '  DCS tools. You can read install.ps1 in Notepad first if you want - all',
    '  it does is copy the hook files into your DCS Scripts\\Hooks folder.',
    '',
    'MANUAL INSTALL (if you would rather not run the .cmd):',
    '  1. Open  %USERPROFILE%\\Saved Games  in File Explorer.',
    '  2. Open your DCS variant folder (DCS, DCS.openbeta, or DCS.server).',
    '  3. Go into Scripts\\Hooks (create those folders if missing).',
    '  4. Copy the three dcsopt_* files into that Hooks folder.',
    '  5. Restart DCS.',
    '',
    'WHAT TO EXPECT:',
    '  One brief minimized window flash when a mission loads - that is the',
    '  background poster starting. After that: nothing visible, ever.',
    '',
    'VERIFY:',
    '  Open the dashboard "DCS Server" page - within ~60 seconds of restarting',
    '  DCS the status should turn green (Connected) with the current mission.',
    '',
    'PRE-CONFIGURED URL (already baked into dcsopt_hook.lua - no editing needed):',
    '  ' + ingestUrl,
    '',
    'TROUBLESHOOTING:',
    '  - Check Saved Games\\<your variant>\\Logs\\dcs.log',
    '  - Search the log for "DCSOPT" - you should see:',
    '      DCSOPT: hook loaded (v2 daemon architecture)',
    '      DCSOPT: mission tracker installed (installed)',
    '      DCSOPT: posting daemon launched',
    '  - If you only see "hook loaded", dcsopt_mission.lua is missing.',
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
    'Install.cmd':        strToU8(INSTALL_CMD),
    'install.ps1':        strToU8(INSTALL_PS1),
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
