import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Resolve the SQLite file path. Priority:
//   1. DB_PATH env var (explicit override — wins always).
//   2. Railway persistent volume mount, if attached (auto: $VOLUME/bot.db).
//      RAILWAY_VOLUME_MOUNT_PATH is the canonical Railway env var.
//      RAILWAY_PERSISTENT_VOLUME_PATH is the older one — checked as a fallback.
//   3. Local dev fallback: ./data/bot.db (NOT persistent on Railway — every
//      deploy would wipe config; tested + documented in commit history).
const volumeMount = (process.env.RAILWAY_VOLUME_MOUNT_PATH
  || process.env.RAILWAY_PERSISTENT_VOLUME_PATH
  || '').replace(/\/$/, '');
const dbPath = process.env.DB_PATH
  || (volumeMount ? `${volumeMount}/bot.db` : './data/bot.db');
mkdirSync(dirname(dbPath), { recursive: true });
console.log(`[db] SQLite at ${dbPath}`);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

// Boot diagnostics — make it obvious whether persisted state survived this
// deploy. If guild_config and role_menus are empty on every boot, the volume
// isn't attached and config is getting wiped → embeds stop working because
// button handlers look up their menu/event/ticket records in the DB.
try {
  const tablesExist = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('guild_config','role_menus')"
  ).all().length;
  if (tablesExist === 2) {
    const cfgRows = db.prepare('SELECT COUNT(*) AS n FROM guild_config').get().n;
    const menuRows = db.prepare('SELECT COUNT(*) AS n FROM role_menus').get().n;
    const onVolume = !!(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.RAILWAY_PERSISTENT_VOLUME_PATH || process.env.DB_PATH);
    console.log(`[db] persistence probe: ${cfgRows} guild config row(s) · ${menuRows} role menu(s) · volume=${onVolume ? 'attached' : 'NOT ATTACHED'}`);
    if (!onVolume) {
      console.warn('[db] ⚠️  DB is on ephemeral storage. Every deploy wipes config + role menus + tickets + giveaways. Attach a Railway volume at /data to fix.');
    }
  }
} catch (err) {
  console.warn('[db] persistence probe failed:', err.message);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id           TEXT PRIMARY KEY,
    welcome_channel_id TEXT,
    welcome_message    TEXT,
    goodbye_channel_id TEXT,
    goodbye_message    TEXT,
    autorole_id        TEXT,
    log_channel_id     TEXT
  );

  CREATE TABLE IF NOT EXISTS warnings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason       TEXT,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings (guild_id, user_id);

  CREATE TABLE IF NOT EXISTS custom_commands (
    guild_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    response   TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, name)
  );
`);

// Idempotent column migrations (SQLite has no "ADD COLUMN IF NOT EXISTS").
function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
ensureColumn('guild_config', 'welcome_embed', 'TEXT'); // JSON embed for welcome
ensureColumn('guild_config', 'goodbye_embed', 'TEXT'); // JSON embed for goodbye
ensureColumn('guild_config', 'automod', 'TEXT');        // JSON automod config
ensureColumn('custom_commands', 'embed', 'TEXT');       // optional JSON embed reply

db.exec(`
  CREATE TABLE IF NOT EXISTS role_menus (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT,
    message_id  TEXT,
    title       TEXT,
    description TEXT,
    buttons     TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mod_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT NOT NULL,
    action        TEXT NOT NULL,
    target_id     TEXT,
    target_tag    TEXT,
    moderator_id  TEXT,
    moderator_tag TEXT,
    reason        TEXT,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_modlog_guild ON mod_log (guild_id, created_at);
`);

// --- batch 3 schema ---
ensureColumn('role_menus', 'type', "TEXT NOT NULL DEFAULT 'buttons'"); // 'buttons' | 'dropdown'
ensureColumn('role_menus', 'max_values', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('guild_config', 'verification', 'TEXT'); // JSON
ensureColumn('guild_config', 'tickets', 'TEXT');       // JSON

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL,
    channel_id       TEXT NOT NULL,
    content          TEXT,
    embed            TEXT,
    type             TEXT NOT NULL DEFAULT 'once',
    interval_seconds INTEGER,
    next_run         INTEGER NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_messages (enabled, next_run);

  CREATE TABLE IF NOT EXISTS reminders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    message    TEXT,
    remind_at  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (remind_at);

  CREATE TABLE IF NOT EXISTS sticky_messages (
    channel_id      TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL,
    content         TEXT,
    embed           TEXT,
    last_message_id TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    opener_id  TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS giveaways (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    prize      TEXT NOT NULL,
    winners    INTEGER NOT NULL DEFAULT 1,
    ends_at    INTEGER NOT NULL,
    ended      INTEGER NOT NULL DEFAULT 0,
    host_id    TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_giveaways_due ON giveaways (ended, ends_at);

  CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL,
    user_id     TEXT NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS youtube_subs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id           TEXT NOT NULL,
    youtube_channel_id TEXT NOT NULL,
    discord_channel_id TEXT NOT NULL,
    mention_role_id    TEXT,
    last_video_id      TEXT,
    created_at         INTEGER NOT NULL
  );
`);

// --- batch 4 schema ---
ensureColumn('guild_config', 'bot_nickname', 'TEXT'); // personalizer nickname
ensureColumn('guild_config', 'embed_color', 'INTEGER'); // personalizer accent color

db.exec(`
  CREATE TABLE IF NOT EXISTS social_subs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id           TEXT NOT NULL,
    platform           TEXT NOT NULL,
    query              TEXT NOT NULL,
    discord_channel_id TEXT NOT NULL,
    mention_role_id    TEXT,
    last_seen          TEXT,
    created_at         INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stat_channels (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    type       TEXT NOT NULL,
    template   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invite_counts (
    guild_id   TEXT NOT NULL,
    inviter_id TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, inviter_id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL,
    channel_id       TEXT,
    message_id       TEXT,
    title            TEXT NOT NULL,
    description      TEXT,
    mission          TEXT,
    map              TEXT,
    image            TEXT,
    start_at         INTEGER NOT NULL,
    reminder_minutes INTEGER NOT NULL DEFAULT 0,
    reminded         INTEGER NOT NULL DEFAULT 0,
    roles            TEXT NOT NULL DEFAULT '[]',
    status           TEXT NOT NULL DEFAULT 'scheduled',
    created_by       TEXT,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_guild ON events (guild_id, start_at);

  CREATE TABLE IF NOT EXISTS event_signups (
    event_id   INTEGER NOT NULL,
    user_id    TEXT NOT NULL,
    role_label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS traps (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    pilot      TEXT NOT NULL,
    grade      TEXT,
    points     REAL NOT NULL DEFAULT 0,
    ship       TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_traps_guild ON traps (guild_id, created_at);

  CREATE TABLE IF NOT EXISTS bomb_scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    pilot      TEXT NOT NULL,
    weapon     TEXT,
    distance   REAL NOT NULL,
    grade      TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bombs_guild ON bomb_scores (guild_id, created_at);

  CREATE TABLE IF NOT EXISTS sorties (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    pilot      TEXT NOT NULL,
    airframe   TEXT,
    seconds    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sorties_guild ON sorties (guild_id, created_at);

  CREATE TABLE IF NOT EXISTS roster (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    callsign   TEXT,
    airframes  TEXT,
    quals      TEXT,
    notes      TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS applications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    user_tag   TEXT,
    answers    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );

  -- Automations: trigger-action rules. One row per rule, with the trigger
  -- type/params and an ordered JSON array of actions to run when it fires.
  CREATE TABLE IF NOT EXISTS automations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id       TEXT NOT NULL,
    name           TEXT NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,
    trigger_type   TEXT NOT NULL,
    trigger_params TEXT NOT NULL DEFAULT '{}',
    actions        TEXT NOT NULL DEFAULT '[]',
    last_fired_at  INTEGER,
    fire_count     INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_automations_guild ON automations (guild_id, trigger_type);

  -- Access Groups: named groups of Discord roles (e.g. "JTAC", "GM", "ATC") that
  -- can be granted permission to perform specific gated bot actions. Per-action
  -- overrides live in guild_config.permission_overrides (JSON).
  CREATE TABLE IF NOT EXISTS access_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    color      TEXT,
    role_ids   TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_access_groups_guild ON access_groups (guild_id);
`);

// --- batch 5 schema (embed options + invite log) ---
ensureColumn('role_menus', 'embed', 'TEXT');          // optional custom embed JSON
ensureColumn('giveaways', 'image', 'TEXT');           // optional embed image
ensureColumn('giveaways', 'description', 'TEXT');     // optional extra description
ensureColumn('guild_config', 'invite_log_channel', 'TEXT');

// --- DCS ingest pipe ---
ensureColumn('guild_config', 'ingest_token', 'TEXT');           // per-guild ingest token
ensureColumn('guild_config', 'server_status', 'TEXT');          // latest status JSON
ensureColumn('guild_config', 'status_channel_id', 'TEXT');      // auto-updating status embed channel
ensureColumn('guild_config', 'status_message_id', 'TEXT');
ensureColumn('guild_config', 'dcs_feed_channel_id', 'TEXT');    // kill/event feed channel
ensureColumn('guild_config', 'status_embed', 'TEXT');           // custom status embed template (JSON)
ensureColumn('guild_config', 'bullseye_lat', 'REAL');           // /bullseye reference
ensureColumn('guild_config', 'bullseye_lon', 'REAL');
ensureColumn('guild_config', 'recruitment', 'TEXT');            // recruitment config JSON
ensureColumn('guild_config', 'onboarding', 'TEXT');             // onboarding wizard config JSON
ensureColumn('guild_config', 'custom_bot_token', 'TEXT');       // optional per-guild bot token (Mee6-style "personalized bot")
ensureColumn('guild_config', 'welcome_page', 'TEXT');           // welcome-channel landing-page layout (Mee6-style)
ensureColumn('guild_config', 'permission_overrides', 'TEXT');   // {actionKey: {mode, group_ids[]}} for Access Groups

db.exec(`
  CREATE TABLE IF NOT EXISTS sent_embeds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    content    TEXT,
    embed      TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sent_embeds_guild ON sent_embeds (guild_id, created_at);

  CREATE TABLE IF NOT EXISTS welcome_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    kind       TEXT NOT NULL,     -- 'welcome' | 'goodbye'
    user_id    TEXT,
    user_tag   TEXT,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    test       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_welcome_log_guild ON welcome_log (guild_id, created_at);
`);
ensureColumn('guild_config', 'readyroom_ingest_url', 'TEXT');   // per-guild ReadyRoom wing ingest URL (sortie fan-out IN)
ensureColumn('guild_config', 'readyroom_outbound_token', 'TEXT');  // per-guild secret ReadyRoom uses to publish to this guild (OUT)
ensureColumn('guild_config', 'readyroom_events_channel_id', 'TEXT'); // channel to post ReadyRoom event embeds into
ensureColumn('tickets', 'claimed_by', 'TEXT');                  // staff who claimed the ticket
ensureColumn('events', 'embed', 'TEXT');                        // custom event embed template (JSON)
ensureColumn('events', 'waitlist', 'INTEGER NOT NULL DEFAULT 0');     // overflow goes to a waitlist
ensureColumn('events', 'multi_signup', 'INTEGER NOT NULL DEFAULT 0'); // allow >1 slot per person
ensureColumn('events', 'recur_days', 'INTEGER NOT NULL DEFAULT 0');   // recurring: repeat every N days (0 = one-off)
ensureColumn('events', 'taskings', 'TEXT');                           // JSON map of flight → tasking (STRIKE/SEAD/…)

// Migrate event_signups PK to (event_id, user_id, role_label) so a user can hold
// multiple slots (needed for multi-crew + multi-signup). One-time, safe (recent table).
{
  const cols = db.prepare('PRAGMA table_info(event_signups)').all();
  const roleIsPk = (cols.find((c) => c.name === 'role_label')?.pk || 0) > 0;
  if (cols.length && !roleIsPk) {
    db.exec(`
      CREATE TABLE event_signups_new (
        event_id INTEGER NOT NULL, user_id TEXT NOT NULL, role_label TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (event_id, user_id, role_label)
      );
      INSERT OR IGNORE INTO event_signups_new (event_id, user_id, role_label, created_at)
        SELECT event_id, user_id, role_label, created_at FROM event_signups;
      DROP TABLE event_signups;
      ALTER TABLE event_signups_new RENAME TO event_signups;
    `);
  }
}

// One-time: fold existing YouTube subs into social_subs as platform 'youtube'.
{
  const ytRows = db.prepare('SELECT * FROM youtube_subs').all();
  if (ytRows.length) {
    const insSoc = db.prepare('INSERT INTO social_subs (guild_id, platform, query, discord_channel_id, mention_role_id, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const delYt = db.prepare('DELETE FROM youtube_subs WHERE id = ?');
    for (const r of ytRows) {
      insSoc.run(r.guild_id, 'youtube', r.youtube_channel_id, r.discord_channel_id, r.mention_role_id, r.last_video_id, r.created_at || Date.now());
      delYt.run(r.id);
    }
    console.log(`Migrated ${ytRows.length} YouTube sub(s) into social_subs.`);
  }
}

const ALLOWED_CONFIG_COLUMNS = new Set([
  'welcome_channel_id', 'welcome_message', 'welcome_embed',
  'goodbye_channel_id', 'goodbye_message', 'goodbye_embed',
  'autorole_id', 'log_channel_id', 'automod',
  'verification', 'tickets', 'bot_nickname', 'embed_color', 'invite_log_channel',
  'ingest_token', 'server_status', 'status_channel_id', 'status_message_id', 'dcs_feed_channel_id', 'status_embed',
  'bullseye_lat', 'bullseye_lon', 'recruitment', 'onboarding', 'readyroom_ingest_url',
  'readyroom_outbound_token', 'readyroom_events_channel_id',
  'custom_bot_token',
]);

// --- guild config helpers ---
const selectConfig = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?');
const ensureConfigRow = db.prepare(
  'INSERT INTO guild_config (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING'
);

export function getConfig(guildId) {
  ensureConfigRow.run(guildId);
  return selectConfig.get(guildId);
}

export function setConfigValue(guildId, column, value) {
  if (!ALLOWED_CONFIG_COLUMNS.has(column)) throw new Error(`Invalid config column: ${column}`);
  getConfig(guildId); // ensure row exists
  db.prepare(`UPDATE guild_config SET ${column} = ? WHERE guild_id = ?`).run(value, guildId);
}

// --- warnings helpers ---
const insertWarning = db.prepare(
  'INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)'
);
const selectWarnings = db.prepare(
  'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at ASC'
);
const deleteWarnings = db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?');

export function addWarning(guildId, userId, moderatorId, reason) {
  const info = insertWarning.run(guildId, userId, moderatorId, reason, Date.now());
  return info.lastInsertRowid;
}
export function getWarnings(guildId, userId) {
  return selectWarnings.all(guildId, userId);
}
export function clearWarnings(guildId, userId) {
  return deleteWarnings.run(guildId, userId).changes;
}

// --- custom command helpers ---
const upsertCommand = db.prepare(`
  INSERT INTO custom_commands (guild_id, name, response, embed, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, name) DO UPDATE SET response = excluded.response, embed = excluded.embed
`);
const selectCommand = db.prepare('SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?');
const selectCommandNames = db.prepare(
  'SELECT name FROM custom_commands WHERE guild_id = ? ORDER BY name ASC'
);
const selectAllCommands = db.prepare(
  'SELECT * FROM custom_commands WHERE guild_id = ? ORDER BY name ASC'
);
const deleteCommand = db.prepare('DELETE FROM custom_commands WHERE guild_id = ? AND name = ?');

export function setCustomCommand(guildId, name, { response = null, embed = null }, createdBy) {
  upsertCommand.run(guildId, name, response, embed, createdBy, Date.now());
}
export function getCustomCommand(guildId, name) {
  return selectCommand.get(guildId, name);
}
export function listCustomCommands(guildId) {
  return selectCommandNames.all(guildId).map((r) => r.name);
}
export function getAllCustomCommands(guildId) {
  return selectAllCommands.all(guildId);
}
export function removeCustomCommand(guildId, name) {
  return deleteCommand.run(guildId, name).changes;
}

// --- automod config ---
export const DEFAULT_AUTOMOD = {
  exemptRoles: [],
  exemptChannels: [],
  rules: {
    spam: { enabled: false, maxMessages: 5, perSeconds: 5, action: 'delete' },
    mentions: { enabled: false, maxMentions: 5, action: 'delete' },
    words: { enabled: false, list: [], action: 'delete' },
    invites: { enabled: false, action: 'delete' },
    links: { enabled: false, allowed: [], action: 'delete' },
  },
};

function mergeAutomod(saved) {
  const base = structuredClone(DEFAULT_AUTOMOD);
  if (!saved || typeof saved !== 'object') return base;
  base.exemptRoles = Array.isArray(saved.exemptRoles) ? saved.exemptRoles : [];
  base.exemptChannels = Array.isArray(saved.exemptChannels) ? saved.exemptChannels : [];
  for (const key of Object.keys(base.rules)) {
    if (saved.rules?.[key]) base.rules[key] = { ...base.rules[key], ...saved.rules[key] };
  }
  return base;
}

export function getAutomod(guildId) {
  const c = getConfig(guildId);
  let parsed = null;
  try { parsed = c.automod ? JSON.parse(c.automod) : null; } catch { /* ignore */ }
  return mergeAutomod(parsed);
}

export function setAutomod(guildId, obj) {
  setConfigValue(guildId, 'automod', JSON.stringify(mergeAutomod(obj)));
  return getAutomod(guildId);
}

// --- role menus ---
const insertRoleMenu = db.prepare(
  'INSERT INTO role_menus (guild_id, channel_id, title, description, buttons, type, max_values, embed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const selectRoleMenu = db.prepare('SELECT * FROM role_menus WHERE id = ?');
const selectRoleMenus = db.prepare('SELECT * FROM role_menus WHERE guild_id = ? ORDER BY created_at DESC');
const deleteRoleMenuStmt = db.prepare('DELETE FROM role_menus WHERE id = ? AND guild_id = ?');
const setRoleMenuMsgStmt = db.prepare('UPDATE role_menus SET channel_id = ?, message_id = ? WHERE id = ?');
const updateRoleMenuStmt = db.prepare(
  'UPDATE role_menus SET title = ?, description = ?, buttons = ?, channel_id = ?, type = ?, max_values = ?, embed = ? WHERE id = ? AND guild_id = ?'
);

const safeParse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const parseMenu = (row) => (row ? { ...row, buttons: safeParse(row.buttons, []), embed: safeParse(row.embed, null) } : null);

export function createRoleMenu(guildId, { channel_id = null, title = '', description = '', buttons = [], type = 'buttons', max_values = 1, embed = null }) {
  const info = insertRoleMenu.run(guildId, channel_id, title, description, JSON.stringify(buttons), type, max_values, embed ? JSON.stringify(embed) : null, Date.now());
  return Number(info.lastInsertRowid);
}
export function getRoleMenu(id) { return parseMenu(selectRoleMenu.get(id)); }
export function getAllRoleMenus(guildId) { return selectRoleMenus.all(guildId).map(parseMenu); }
export function updateRoleMenu(id, guildId, { title, description, buttons, channel_id, type = 'buttons', max_values = 1, embed = null }) {
  updateRoleMenuStmt.run(title, description, JSON.stringify(buttons || []), channel_id, type, max_values, embed ? JSON.stringify(embed) : null, id, guildId);
  return getRoleMenu(id);
}
export function setRoleMenuMessage(id, channelId, messageId) {
  setRoleMenuMsgStmt.run(channelId, messageId, id);
}
export function deleteRoleMenu(id, guildId) { return deleteRoleMenuStmt.run(id, guildId).changes; }

// --- mod log ---
const insertModLog = db.prepare(`
  INSERT INTO mod_log (guild_id, action, target_id, target_tag, moderator_id, moderator_tag, reason, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectModLog = db.prepare('SELECT * FROM mod_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?');

export function addModLog({ guildId, action, targetId, targetTag, moderatorId, moderatorTag, reason }) {
  insertModLog.run(guildId, action, targetId ?? null, targetTag ?? null, moderatorId ?? null, moderatorTag ?? null, reason ?? null, Date.now());
}
export function getModLog(guildId, limit = 50) { return selectModLog.all(guildId, limit); }

// --- warnings (web panel additions) ---
const selectAllWarnings = db.prepare('SELECT * FROM warnings WHERE guild_id = ? ORDER BY created_at DESC');
const deleteWarningByIdStmt = db.prepare('DELETE FROM warnings WHERE guild_id = ? AND id = ?');
export function getAllWarnings(guildId) { return selectAllWarnings.all(guildId); }
export function deleteWarningById(guildId, id) { return deleteWarningByIdStmt.run(guildId, id).changes; }

// --- verification & tickets config (JSON in guild_config) ---
const DEFAULT_VERIFICATION = {
  enabled: false, channel_id: null, role_id: null, message_id: null,
  title: 'Verify', description: 'Click the button below to verify and gain access to the server.',
  button_label: 'Verify',
};
const DEFAULT_TICKETS = {
  enabled: false, panel_channel_id: null, panel_message_id: null, category_id: null, support_role_id: null,
  title: 'Support', description: 'Click the button below to open a private ticket with the staff team.',
  button_label: 'Open Ticket',
  open_message: 'Thanks for opening a ticket — staff will be with you shortly. Use the button to close it when done.',
};

export function getVerification(guildId) {
  return { ...DEFAULT_VERIFICATION, ...safeParse(getConfig(guildId).verification, {}) };
}
export function setVerification(guildId, obj) {
  const merged = { ...getVerification(guildId), ...obj };
  setConfigValue(guildId, 'verification', JSON.stringify(merged));
  return merged;
}
export function getTicketsConfig(guildId) {
  return { ...DEFAULT_TICKETS, ...safeParse(getConfig(guildId).tickets, {}) };
}
export function setTicketsConfig(guildId, obj) {
  const merged = { ...getTicketsConfig(guildId), ...obj };
  setConfigValue(guildId, 'tickets', JSON.stringify(merged));
  return merged;
}

// --- tickets table ---
const insertTicket = db.prepare('INSERT INTO tickets (guild_id, channel_id, opener_id, created_at) VALUES (?, ?, ?, ?)');
const selectOpenTicketByOpener = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = 'open'");
const selectTicketByChannel = db.prepare('SELECT * FROM tickets WHERE channel_id = ?');
const closeTicketStmt = db.prepare("UPDATE tickets SET status = 'closed' WHERE channel_id = ?");
export function createTicket(guildId, channelId, openerId) {
  return Number(insertTicket.run(guildId, channelId, openerId, Date.now()).lastInsertRowid);
}
export function getOpenTicketByOpener(guildId, openerId) { return selectOpenTicketByOpener.get(guildId, openerId); }
export function getTicketByChannel(channelId) { return selectTicketByChannel.get(channelId); }
export function closeTicket(channelId) { return closeTicketStmt.run(channelId).changes; }
const claimTicketStmt = db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ?');
export function claimTicket(channelId, userId) { return claimTicketStmt.run(userId, channelId).changes; }

// --- scheduled messages ---
const insertSched = db.prepare('INSERT INTO scheduled_messages (guild_id, channel_id, content, embed, type, interval_seconds, next_run, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const selectScheds = db.prepare('SELECT * FROM scheduled_messages WHERE guild_id = ? ORDER BY created_at DESC');
const selectSchedDue = db.prepare('SELECT * FROM scheduled_messages WHERE enabled = 1 AND next_run <= ?');
const updateSchedStmt = db.prepare('UPDATE scheduled_messages SET channel_id = ?, content = ?, embed = ?, type = ?, interval_seconds = ?, next_run = ?, enabled = ? WHERE id = ? AND guild_id = ?');
const deleteSchedStmt = db.prepare('DELETE FROM scheduled_messages WHERE id = ? AND guild_id = ?');
const advanceSchedStmt = db.prepare('UPDATE scheduled_messages SET next_run = ? WHERE id = ?');
const disableSchedStmt = db.prepare('UPDATE scheduled_messages SET enabled = 0 WHERE id = ?');
const parseSched = (r) => (r ? { ...r, embed: safeParse(r.embed, null), enabled: !!r.enabled } : null);
export function createScheduled(guildId, d) {
  return Number(insertSched.run(guildId, d.channel_id, d.content ?? null, d.embed ? JSON.stringify(d.embed) : null, d.type || 'once', d.interval_seconds ?? null, d.next_run, d.enabled ? 1 : 0, Date.now()).lastInsertRowid);
}
export function getScheduledAll(guildId) { return selectScheds.all(guildId).map(parseSched); }
export function getScheduledDue(now) { return selectSchedDue.all(now).map(parseSched); }
export function updateScheduled(id, guildId, d) {
  updateSchedStmt.run(d.channel_id, d.content ?? null, d.embed ? JSON.stringify(d.embed) : null, d.type || 'once', d.interval_seconds ?? null, d.next_run, d.enabled ? 1 : 0, id, guildId);
}
export function deleteScheduled(id, guildId) { return deleteSchedStmt.run(id, guildId).changes; }
export function advanceScheduled(id, nextRun) { advanceSchedStmt.run(nextRun, id); }
export function disableScheduled(id) { disableSchedStmt.run(id); }

// --- reminders ---
const insertReminder = db.prepare('INSERT INTO reminders (guild_id, channel_id, user_id, message, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const selectRemindersDue = db.prepare('SELECT * FROM reminders WHERE remind_at <= ?');
const deleteReminderStmt = db.prepare('DELETE FROM reminders WHERE id = ?');
export function addReminder(d) { return Number(insertReminder.run(d.guildId, d.channelId, d.userId, d.message, d.remindAt, Date.now()).lastInsertRowid); }
export function getRemindersDue(now) { return selectRemindersDue.all(now); }
export function deleteReminderById(id) { return deleteReminderStmt.run(id).changes; }

// --- sticky messages ---
const upsertSticky = db.prepare(`
  INSERT INTO sticky_messages (channel_id, guild_id, content, embed, enabled) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(channel_id) DO UPDATE SET content = excluded.content, embed = excluded.embed, enabled = excluded.enabled
`);
const selectSticky = db.prepare('SELECT * FROM sticky_messages WHERE channel_id = ?');
const selectStickies = db.prepare('SELECT * FROM sticky_messages WHERE guild_id = ?');
const deleteStickyStmt = db.prepare('DELETE FROM sticky_messages WHERE channel_id = ? AND guild_id = ?');
const setStickyLastStmt = db.prepare('UPDATE sticky_messages SET last_message_id = ? WHERE channel_id = ?');
const parseSticky = (r) => (r ? { ...r, embed: safeParse(r.embed, null), enabled: !!r.enabled } : null);
export function setSticky(guildId, channelId, { content, embed, enabled = true }) {
  upsertSticky.run(channelId, guildId, content ?? null, embed ? JSON.stringify(embed) : null, enabled ? 1 : 0);
  return parseSticky(selectSticky.get(channelId));
}
export function getSticky(channelId) { return parseSticky(selectSticky.get(channelId)); }
export function getStickies(guildId) { return selectStickies.all(guildId).map(parseSticky); }
export function deleteSticky(channelId, guildId) { return deleteStickyStmt.run(channelId, guildId).changes; }
export function setStickyLastMessage(channelId, messageId) { setStickyLastStmt.run(messageId, channelId); }

// --- giveaways ---
const insertGiveaway = db.prepare('INSERT INTO giveaways (guild_id, channel_id, prize, winners, ends_at, host_id, image, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const selectGiveaway = db.prepare('SELECT * FROM giveaways WHERE id = ?');
const selectGiveaways = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY created_at DESC');
const selectGiveawaysDue = db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?');
const setGiveawayMsgStmt = db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?');
const markGiveawayEndedStmt = db.prepare('UPDATE giveaways SET ended = 1 WHERE id = ?');
const rescheduleGiveawayStmt = db.prepare('UPDATE giveaways SET ends_at = ?, ended = 0 WHERE id = ?');
const deleteGiveawayStmt = db.prepare('DELETE FROM giveaways WHERE id = ? AND guild_id = ?');
const insertEntry = db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)');
const deleteEntryStmt = db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?');
const countEntries = db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?');
const selectEntries = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?');
const hasEntryStmt = db.prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?');
export function createGiveaway(guildId, { channel_id, prize, winners = 1, ends_at, host_id, image = null, description = null }) {
  return Number(insertGiveaway.run(guildId, channel_id, prize, winners, ends_at, host_id ?? null, image, description, Date.now()).lastInsertRowid);
}
export function getGiveaway(id) { return selectGiveaway.get(id); }
export function getGiveaways(guildId) { return selectGiveaways.all(guildId); }
export function getGiveawaysDue(now) { return selectGiveawaysDue.all(now); }
export function setGiveawayMessage(id, messageId) { setGiveawayMsgStmt.run(messageId, id); }
export function endGiveaway(id) { markGiveawayEndedStmt.run(id); }
export function rescheduleGiveaway(id, endsAt) { rescheduleGiveawayStmt.run(endsAt, id); }
export function deleteGiveaway(id, guildId) { return deleteGiveawayStmt.run(id, guildId).changes; }
export function toggleGiveawayEntry(giveawayId, userId) {
  if (hasEntryStmt.get(giveawayId, userId)) { deleteEntryStmt.run(giveawayId, userId); return false; }
  insertEntry.run(giveawayId, userId); return true;
}
export function getGiveawayEntryCount(id) { return countEntries.get(id).n; }
export function getGiveawayEntries(id) { return selectEntries.all(id).map((r) => r.user_id); }

// --- youtube subscriptions ---
const insertYt = db.prepare('INSERT INTO youtube_subs (guild_id, youtube_channel_id, discord_channel_id, mention_role_id, created_at) VALUES (?, ?, ?, ?, ?)');
const selectYtByGuild = db.prepare('SELECT * FROM youtube_subs WHERE guild_id = ? ORDER BY created_at DESC');
const selectAllYt = db.prepare('SELECT * FROM youtube_subs');
const deleteYtStmt = db.prepare('DELETE FROM youtube_subs WHERE id = ? AND guild_id = ?');
const setYtLastStmt = db.prepare('UPDATE youtube_subs SET last_video_id = ? WHERE id = ?');
export function createYoutubeSub(guildId, { youtube_channel_id, discord_channel_id, mention_role_id = null }) {
  return Number(insertYt.run(guildId, youtube_channel_id, discord_channel_id, mention_role_id, Date.now()).lastInsertRowid);
}
export function getYoutubeSubs(guildId) { return selectYtByGuild.all(guildId); }
export function getAllYoutubeSubs() { return selectAllYt.all(); }
export function deleteYoutubeSub(id, guildId) { return deleteYtStmt.run(id, guildId).changes; }
export function setYoutubeLastVideo(id, videoId) { setYtLastStmt.run(videoId, id); }

// --- social subscriptions (reddit / rss / twitch / kick) ---
const insertSocial = db.prepare('INSERT INTO social_subs (guild_id, platform, query, discord_channel_id, mention_role_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const selectSocialByGuild = db.prepare('SELECT * FROM social_subs WHERE guild_id = ? ORDER BY created_at DESC');
const selectAllSocial = db.prepare('SELECT * FROM social_subs');
const deleteSocialStmt = db.prepare('DELETE FROM social_subs WHERE id = ? AND guild_id = ?');
const setSocialSeenStmt = db.prepare('UPDATE social_subs SET last_seen = ? WHERE id = ?');
export function createSocialSub(guildId, { platform, query, discord_channel_id, mention_role_id = null }) {
  return Number(insertSocial.run(guildId, platform, query, discord_channel_id, mention_role_id, Date.now()).lastInsertRowid);
}
export function getSocialSubs(guildId) { return selectSocialByGuild.all(guildId); }
export function getAllSocialSubs() { return selectAllSocial.all(); }
export function deleteSocialSub(id, guildId) { return deleteSocialStmt.run(id, guildId).changes; }
export function setSocialLastSeen(id, value) { setSocialSeenStmt.run(value, id); }

// --- stat counter channels ---
const insertStat = db.prepare('INSERT INTO stat_channels (guild_id, channel_id, type, template, created_at) VALUES (?, ?, ?, ?, ?)');
const selectStatsByGuild = db.prepare('SELECT * FROM stat_channels WHERE guild_id = ? ORDER BY created_at ASC');
const selectAllStats = db.prepare('SELECT * FROM stat_channels');
const deleteStatStmt = db.prepare('DELETE FROM stat_channels WHERE id = ? AND guild_id = ?');
export function createStatChannel(guildId, { channel_id, type, template }) {
  return Number(insertStat.run(guildId, channel_id, type, template, Date.now()).lastInsertRowid);
}
export function getStatChannels(guildId) { return selectStatsByGuild.all(guildId); }
export function getAllStatChannels() { return selectAllStats.all(); }
export function deleteStatChannel(id, guildId) { return deleteStatStmt.run(id, guildId).changes; }

// --- invite tracker ---
const incInvite = db.prepare(`
  INSERT INTO invite_counts (guild_id, inviter_id, count) VALUES (?, ?, 1)
  ON CONFLICT(guild_id, inviter_id) DO UPDATE SET count = count + 1
`);
const selectInvites = db.prepare('SELECT * FROM invite_counts WHERE guild_id = ? ORDER BY count DESC LIMIT 100');
export function incrementInvite(guildId, inviterId) { incInvite.run(guildId, inviterId); }
export function getInviteLeaderboard(guildId) { return selectInvites.all(guildId); }

// --- welcome / goodbye send log (for the dashboard "Recent posts" panel) ---
const insertWelcomeLog = db.prepare(
  'INSERT INTO welcome_log (guild_id, kind, user_id, user_tag, channel_id, message_id, test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const selectWelcomeLog = db.prepare('SELECT * FROM welcome_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50');
const selectWelcomeLogById = db.prepare('SELECT * FROM welcome_log WHERE id = ? AND guild_id = ?');
const deleteWelcomeLogStmt = db.prepare('DELETE FROM welcome_log WHERE id = ? AND guild_id = ?');
export function logWelcome(guildId, { kind, user_id, user_tag, channel_id, message_id, test = false }) {
  return Number(insertWelcomeLog.run(guildId, kind, user_id ?? null, user_tag ?? null, channel_id, message_id ?? null, test ? 1 : 0, Date.now()).lastInsertRowid);
}
export function getWelcomeLog(guildId) { return selectWelcomeLog.all(guildId).map((r) => ({ ...r, test: !!r.test })); }
export function getWelcomeLogEntry(id, guildId) {
  const r = selectWelcomeLogById.get(id, guildId);
  return r ? { ...r, test: !!r.test } : null;
}
export function deleteWelcomeLogEntry(id, guildId) { return deleteWelcomeLogStmt.run(id, guildId).changes; }

// --- sent embeds (tracked /announce posts so they can be edited / deleted later) ---
const insertSentEmbed = db.prepare(
  'INSERT INTO sent_embeds (guild_id, channel_id, message_id, content, embed, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const selectSentEmbed = db.prepare('SELECT * FROM sent_embeds WHERE id = ? AND guild_id = ?');
const selectSentEmbeds = db.prepare('SELECT * FROM sent_embeds WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100');
const updateSentEmbedStmt = db.prepare('UPDATE sent_embeds SET content = ?, embed = ? WHERE id = ? AND guild_id = ?');
const deleteSentEmbedStmt = db.prepare('DELETE FROM sent_embeds WHERE id = ? AND guild_id = ?');
const parseSentEmbed = (r) => (r ? { ...r, embed: safeParse(r.embed, null) } : null);
export function createSentEmbed(guildId, { channel_id, message_id, content, embed, created_by }) {
  return Number(insertSentEmbed.run(guildId, channel_id, message_id, content ?? null, embed ? JSON.stringify(embed) : null, created_by ?? null, Date.now()).lastInsertRowid);
}
export function getSentEmbed(id, guildId) { return parseSentEmbed(selectSentEmbed.get(id, guildId)); }
export function getSentEmbeds(guildId) { return selectSentEmbeds.all(guildId).map(parseSentEmbed); }
export function updateSentEmbed(id, guildId, { content, embed }) {
  return updateSentEmbedStmt.run(content ?? null, embed ? JSON.stringify(embed) : null, id, guildId).changes;
}
export function deleteSentEmbed(id, guildId) { return deleteSentEmbedStmt.run(id, guildId).changes; }

// --- custom (per-guild) bot tokens ---
export function getCustomBotToken(guildId) { return getConfig(guildId).custom_bot_token || null; }
export function setCustomBotToken(guildId, token) { setConfigValue(guildId, 'custom_bot_token', token || null); }
const selectAllCustomBots = db.prepare("SELECT guild_id, custom_bot_token FROM guild_config WHERE custom_bot_token IS NOT NULL AND custom_bot_token != ''");
export function getAllCustomBotTokens() { return selectAllCustomBots.all(); }

// --- personalizer ---
export function getPersonalization(guildId) {
  const c = getConfig(guildId);
  return { bot_nickname: c.bot_nickname || null, embed_color: c.embed_color ?? null };
}
export function setPersonalization(guildId, { bot_nickname, embed_color }) {
  setConfigValue(guildId, 'bot_nickname', bot_nickname || null);
  setConfigValue(guildId, 'embed_color', Number.isFinite(embed_color) ? embed_color : null);
  return getPersonalization(guildId);
}

// --- events (mission scheduler) ---
const insertEvent = db.prepare(`
  INSERT INTO events (guild_id, channel_id, title, description, mission, map, image, start_at, reminder_minutes, roles, embed, waitlist, multi_signup, recur_days, taskings, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectEvent = db.prepare('SELECT * FROM events WHERE id = ?');
const selectEventsByGuild = db.prepare('SELECT * FROM events WHERE guild_id = ? ORDER BY start_at ASC');
const updateEventStmt = db.prepare(`
  UPDATE events SET channel_id = ?, title = ?, description = ?, mission = ?, map = ?, image = ?, start_at = ?, reminder_minutes = ?, roles = ?, embed = ?, waitlist = ?, multi_signup = ?, recur_days = ?, taskings = ?
  WHERE id = ? AND guild_id = ?
`);
const setEventMsgStmt = db.prepare('UPDATE events SET channel_id = ?, message_id = ? WHERE id = ?');
const setEventStatusStmt = db.prepare('UPDATE events SET status = ? WHERE id = ? AND guild_id = ?');
const markRemindedStmt = db.prepare('UPDATE events SET reminded = 1 WHERE id = ?');
const deleteEventStmt = db.prepare('DELETE FROM events WHERE id = ? AND guild_id = ?');
// Allow reminders up to 30 minutes past start so a deploy gap during the
// reminder window doesn't silently drop the ping.
const selectEventsToRemind = db.prepare(
  "SELECT * FROM events WHERE status = 'scheduled' AND reminded = 0 AND reminder_minutes > 0 AND ? >= (start_at - reminder_minutes * 60000) AND ? < start_at + 1800000"
);
const parseEvent = (r) => (r ? { ...r, roles: safeParse(r.roles, []), embed: safeParse(r.embed, null), taskings: safeParse(r.taskings, {}), waitlist: !!r.waitlist, multi_signup: !!r.multi_signup } : null);

export function createEvent(guildId, d) {
  return Number(insertEvent.run(
    guildId, d.channel_id ?? null, d.title, d.description ?? null, d.mission ?? null, d.map ?? null,
    d.image ?? null, d.start_at, d.reminder_minutes ?? 0, JSON.stringify(d.roles || []),
    d.embed ? JSON.stringify(d.embed) : null, d.waitlist ? 1 : 0, d.multi_signup ? 1 : 0, d.recur_days ?? 0,
    d.taskings && Object.keys(d.taskings).length ? JSON.stringify(d.taskings) : null,
    d.created_by ?? null, Date.now()
  ).lastInsertRowid);
}
export function getEvent(id) { return parseEvent(selectEvent.get(id)); }
export function getEvents(guildId) { return selectEventsByGuild.all(guildId).map(parseEvent); }
export function updateEvent(id, guildId, d) {
  updateEventStmt.run(
    d.channel_id ?? null, d.title, d.description ?? null, d.mission ?? null, d.map ?? null, d.image ?? null,
    d.start_at, d.reminder_minutes ?? 0, JSON.stringify(d.roles || []),
    d.embed ? JSON.stringify(d.embed) : null, d.waitlist ? 1 : 0, d.multi_signup ? 1 : 0, d.recur_days ?? 0,
    d.taskings && Object.keys(d.taskings).length ? JSON.stringify(d.taskings) : null,
    id, guildId,
  );
  return getEvent(id);
}
export function setEventMessage(id, channelId, messageId) { setEventMsgStmt.run(channelId, messageId, id); }
export function setEventStatus(id, guildId, status) { return setEventStatusStmt.run(status, id, guildId).changes; }
export function markEventReminded(id) { markRemindedStmt.run(id); }
export function deleteEvent(id, guildId) { return deleteEventStmt.run(id, guildId).changes; }
export function getEventsToRemind(now) { return selectEventsToRemind.all(now, now).map(parseEvent); }

// Past one-off events that should be auto-archived (caller passes now - grace).
// Recurring events skip this — they roll over instead via getRecurringDue().
const selectExpiredEvents = db.prepare("SELECT * FROM events WHERE status = 'scheduled' AND recur_days = 0 AND start_at < ?");
export function getExpiredEvents(cutoff) { return selectExpiredEvents.all(cutoff).map(parseEvent); }

// Recurring events whose occurrence is already past (caller passes now - grace).
const selectRecurringDue = db.prepare("SELECT * FROM events WHERE recur_days > 0 AND status = 'scheduled' AND start_at <= ?");
const rolloverEventStmt = db.prepare('UPDATE events SET start_at = ?, reminded = 0 WHERE id = ?');
const clearEventSignups = db.prepare('DELETE FROM event_signups WHERE event_id = ?');
export function getRecurringDue(cutoff) { return selectRecurringDue.all(cutoff).map(parseEvent); }
export function rolloverEvent(id, newStartAt) {
  rolloverEventStmt.run(newStartAt, id);
  clearEventSignups.run(id);
}

// --- event signups ---
const upsertSignup = db.prepare(`
  INSERT INTO event_signups (event_id, user_id, role_label, created_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(event_id, user_id, role_label) DO NOTHING
`);
const deleteUserRoleStmt = db.prepare('DELETE FROM event_signups WHERE event_id = ? AND user_id = ? AND role_label = ?');
const deleteAllUserStmt = db.prepare('DELETE FROM event_signups WHERE event_id = ? AND user_id = ?');
const selectSignups = db.prepare('SELECT * FROM event_signups WHERE event_id = ? ORDER BY created_at ASC');
const selectUserSignups = db.prepare('SELECT * FROM event_signups WHERE event_id = ? AND user_id = ?');
const countSignupsForRole = db.prepare('SELECT COUNT(*) AS n FROM event_signups WHERE event_id = ? AND role_label = ?');

export function setSignup(eventId, userId, roleLabel) { upsertSignup.run(eventId, userId, roleLabel, Date.now()); }
export function removeUserRole(eventId, userId, roleLabel) { return deleteUserRoleStmt.run(eventId, userId, roleLabel).changes; }
export function removeAllUserSignups(eventId, userId) { return deleteAllUserStmt.run(eventId, userId).changes; }
export function getSignups(eventId) { return selectSignups.all(eventId); }
export function getUserSignups(eventId, userId) { return selectUserSignups.all(eventId, userId); }
export function countRoleSignups(eventId, roleLabel) { return countSignupsForRole.get(eventId, roleLabel).n; }

// --- DCS ingest / server status ---
const selectGuildByToken = db.prepare('SELECT guild_id FROM guild_config WHERE ingest_token = ?');

export function getGuildByIngestToken(token) {
  if (!token) return null;
  return selectGuildByToken.get(token)?.guild_id || null;
}
export function getIngestToken(guildId) {
  let token = getConfig(guildId).ingest_token;
  if (!token) { token = randomBytes(24).toString('hex'); setConfigValue(guildId, 'ingest_token', token); }
  return token;
}
export function regenerateIngestToken(guildId) {
  const token = randomBytes(24).toString('hex');
  setConfigValue(guildId, 'ingest_token', token);
  return token;
}

// --- ReadyRoom outbound token (parallel to ingest_token, but ReadyRoom is the *caller* here) ---
const selectGuildByOutboundToken = db.prepare(
  'SELECT guild_id FROM guild_config WHERE readyroom_outbound_token = ?'
);
export function getGuildByReadyroomOutboundToken(token) {
  if (!token) return null;
  return selectGuildByOutboundToken.get(token)?.guild_id || null;
}
export function getReadyroomOutboundToken(guildId) {
  let token = getConfig(guildId).readyroom_outbound_token;
  if (!token) {
    token = randomBytes(24).toString('hex');
    setConfigValue(guildId, 'readyroom_outbound_token', token);
  }
  return token;
}
export function regenerateReadyroomOutboundToken(guildId) {
  const token = randomBytes(24).toString('hex');
  setConfigValue(guildId, 'readyroom_outbound_token', token);
  return token;
}
export function getServerStatus(guildId) {
  return safeParse(getConfig(guildId).server_status, null);
}
export function setServerStatus(guildId, status) {
  setConfigValue(guildId, 'server_status', JSON.stringify(status));
}
export function setStatusMessage(guildId, channelId, messageId) {
  setConfigValue(guildId, 'status_channel_id', channelId);
  setConfigValue(guildId, 'status_message_id', messageId);
}

// --- carrier traps ---
const insertTrap = db.prepare('INSERT INTO traps (guild_id, pilot, grade, points, ship, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const selectTrapBoard = db.prepare(`
  SELECT pilot, COUNT(*) AS traps, ROUND(AVG(points), 2) AS avg_points, MAX(points) AS best
  FROM traps WHERE guild_id = ? GROUP BY pilot ORDER BY avg_points DESC, traps DESC LIMIT 50
`);
const selectRecentTraps = db.prepare('SELECT * FROM traps WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?');

export function addTrap(guildId, { pilot, grade, points, ship }) {
  insertTrap.run(guildId, pilot, grade ?? null, points ?? 0, ship ?? null, Date.now());
}
export function getTrapLeaderboard(guildId) { return selectTrapBoard.all(guildId); }
export function getRecentTraps(guildId, limit = 20) { return selectRecentTraps.all(guildId, limit); }

// --- bomb scores ---
const insertBomb = db.prepare('INSERT INTO bomb_scores (guild_id, pilot, weapon, distance, grade, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const selectBombBoard = db.prepare(`
  SELECT pilot, COUNT(*) AS drops, ROUND(AVG(distance), 1) AS avg_m, ROUND(MIN(distance), 1) AS best_m
  FROM bomb_scores WHERE guild_id = ? GROUP BY pilot ORDER BY avg_m ASC LIMIT 50
`);
const selectRecentBombs = db.prepare('SELECT * FROM bomb_scores WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?');
export function addBombScore(guildId, { pilot, weapon, distance, grade }) {
  insertBomb.run(guildId, pilot, weapon ?? null, distance, grade ?? null, Date.now());
}
export function getBombLeaderboard(guildId) { return selectBombBoard.all(guildId); }
export function getRecentBombs(guildId, limit = 20) { return selectRecentBombs.all(guildId, limit); }

// --- sorties ---
const insertSortie = db.prepare('INSERT INTO sorties (guild_id, pilot, airframe, seconds, created_at) VALUES (?, ?, ?, ?, ?)');
const selectSortieBoard = db.prepare(`
  SELECT pilot, COUNT(*) AS sorties, SUM(seconds) AS total_seconds
  FROM sorties WHERE guild_id = ? GROUP BY pilot ORDER BY total_seconds DESC LIMIT 50
`);
const selectRecentSorties = db.prepare('SELECT * FROM sorties WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?');
export function addSortie(guildId, { pilot, airframe, seconds }) {
  insertSortie.run(guildId, pilot, airframe ?? null, Math.max(0, Number(seconds) || 0), Date.now());
}
export function getSortieLeaderboard(guildId) { return selectSortieBoard.all(guildId); }
export function getRecentSorties(guildId, limit = 20) { return selectRecentSorties.all(guildId, limit); }

// --- bullseye ---
export function getBullseye(guildId) {
  const c = getConfig(guildId);
  return c.bullseye_lat != null && c.bullseye_lon != null ? { lat: c.bullseye_lat, lon: c.bullseye_lon } : null;
}
export function setBullseye(guildId, lat, lon) {
  setConfigValue(guildId, 'bullseye_lat', lat);
  setConfigValue(guildId, 'bullseye_lon', lon);
}

// --- roster ---
const upsertRoster = db.prepare(`
  INSERT INTO roster (guild_id, user_id, callsign, airframes, quals, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET callsign = excluded.callsign, airframes = excluded.airframes, quals = excluded.quals, notes = excluded.notes, updated_at = excluded.updated_at
`);
const selectRoster = db.prepare('SELECT * FROM roster WHERE guild_id = ? ORDER BY callsign ASC');
const selectRosterEntry = db.prepare('SELECT * FROM roster WHERE guild_id = ? AND user_id = ?');
const deleteRosterEntry = db.prepare('DELETE FROM roster WHERE guild_id = ? AND user_id = ?');
export function setRosterEntry(guildId, userId, { callsign, airframes, quals, notes }) {
  upsertRoster.run(guildId, userId, callsign ?? null, airframes ?? null, quals ?? null, notes ?? null, Date.now());
}
export function getRoster(guildId) { return selectRoster.all(guildId); }
export function getRosterEntry(guildId, userId) { return selectRosterEntry.get(guildId, userId); }
export function deleteRoster(guildId, userId) { return deleteRosterEntry.run(guildId, userId).changes; }

// --- recruitment config ---
const DEFAULT_RECRUITMENT = {
  enabled: false, panel_channel_id: null, panel_message_id: null, review_channel_id: null, approve_role_id: null,
  title: 'Join the Squadron', description: 'Click below to apply.', button_label: 'Apply',
  questions: [{ label: 'Your callsign / name', required: true }, { label: 'Timezone & availability', required: true }, { label: 'DCS modules you fly', required: false }],
};
export function getRecruitment(guildId) {
  return { ...DEFAULT_RECRUITMENT, ...safeParse(getConfig(guildId).recruitment, {}) };
}
export function setRecruitment(guildId, obj) {
  const merged = { ...getRecruitment(guildId), ...obj };
  setConfigValue(guildId, 'recruitment', JSON.stringify(merged));
  return merged;
}

// --- onboarding wizard config ---
const DEFAULT_ONBOARDING = {
  enabled: false,
  panel_channel_id: null,
  panel_message_id: null,
  completion_role_id: null,
  title: 'Welcome to the Squadron',
  description: 'New here? Click **Get Started** below for a quick guided tour — pick your roles, learn the essentials, and get set up in under a minute.',
  button_label: 'Get Started',
  embed: null,            // optional custom panel embed
  finish_message: 'You’re all set — welcome aboard! Head into the server and say hi. 🫡',
  steps: [
    {
      title: 'Welcome aboard',
      description: 'Glad to have you. This quick walkthrough will get you set up. Use the buttons below to move between steps.',
      image: null,
      roles: [],
    },
    {
      title: 'Pick your roles',
      description: 'Tap the role buttons below to grant yourself access to the channels and pings you care about. You can change these any time.',
      image: null,
      roles: [],
    },
    {
      title: 'Read the essentials',
      description: 'Make sure you’ve skimmed the rules and announcements channels so you know how things work around here.',
      image: null,
      roles: [],
    },
  ],
};

function mergeOnboarding(saved) {
  const base = { ...DEFAULT_ONBOARDING, ...(saved && typeof saved === 'object' ? saved : {}) };
  base.steps = Array.isArray(saved?.steps) ? saved.steps.map((s) => ({
    title: s?.title || '',
    description: s?.description || '',
    image: s?.image || null,
    roles: Array.isArray(s?.roles)
      ? s.roles.filter((r) => r && r.role_id).map((r) => ({ role_id: String(r.role_id), label: r.label || 'Role', emoji: r.emoji || null }))
      : [],
  })) : DEFAULT_ONBOARDING.steps;
  base.embed = saved?.embed ?? null;
  return base;
}

export function getOnboarding(guildId) {
  return mergeOnboarding(safeParse(getConfig(guildId).onboarding, {}));
}
export function setOnboarding(guildId, obj) {
  const merged = mergeOnboarding({ ...getOnboarding(guildId), ...obj });
  setConfigValue(guildId, 'onboarding', JSON.stringify(merged));
  return merged;
}

// --- Access Groups (JTAC/GM/ATC-style named role bundles for gated actions) ---
const insertAccessGroup = db.prepare('INSERT INTO access_groups (guild_id, name, color, role_ids, created_at) VALUES (?, ?, ?, ?, ?)');
const updateAccessGroup = db.prepare('UPDATE access_groups SET name = ?, color = ?, role_ids = ? WHERE id = ? AND guild_id = ?');
const deleteAccessGroupStmt = db.prepare('DELETE FROM access_groups WHERE id = ? AND guild_id = ?');
const selectAccessGroup = db.prepare('SELECT * FROM access_groups WHERE id = ? AND guild_id = ?');
const selectAccessGroups = db.prepare('SELECT * FROM access_groups WHERE guild_id = ? ORDER BY created_at');
const parseGroup = (r) => (r ? { ...r, role_ids: safeParse(r.role_ids, []) } : null);

export function getAccessGroups(guildId) {
  return selectAccessGroups.all(guildId).map(parseGroup);
}
export function getAccessGroup(guildId, id) {
  return parseGroup(selectAccessGroup.get(id, guildId));
}
export function createAccessGroup(guildId, { name, color, role_ids }) {
  const id = Number(insertAccessGroup.run(
    guildId, String(name || 'New group').slice(0, 80),
    color || null,
    JSON.stringify(Array.isArray(role_ids) ? role_ids : []),
    Date.now()
  ).lastInsertRowid);
  return getAccessGroup(guildId, id);
}
export function updateAccessGroupRow(guildId, id, { name, color, role_ids }) {
  updateAccessGroup.run(
    String(name || 'Group').slice(0, 80),
    color || null,
    JSON.stringify(Array.isArray(role_ids) ? role_ids : []),
    id, guildId,
  );
  return getAccessGroup(guildId, id);
}
export function deleteAccessGroup(guildId, id) {
  return deleteAccessGroupStmt.run(id, guildId).changes;
}

// Permission overrides: a JSON map of {actionKey: {mode, group_ids[]}}.
// mode='admin' → ManageGuild required (the default if not configured)
// mode='groups' → any role in any listed group permits the action
// mode='everyone' → no extra check beyond what Discord's own perms enforce
export function getPermissionOverrides(guildId) {
  return safeParse(getConfig(guildId).permission_overrides, {}) || {};
}
export function setPermissionOverrides(guildId, map) {
  const clean = {};
  for (const [key, v] of Object.entries(map || {})) {
    const mode = ['admin', 'groups', 'everyone'].includes(v?.mode) ? v.mode : 'admin';
    const groupIds = Array.isArray(v?.group_ids) ? v.group_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
    clean[String(key)] = { mode, group_ids: groupIds };
  }
  setConfigValue(guildId, 'permission_overrides', JSON.stringify(clean));
  return clean;
}

// --- Automations (trigger-action rules) ---
const insertAutomation = db.prepare('INSERT INTO automations (guild_id, name, enabled, trigger_type, trigger_params, actions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
const updateAutomationStmt = db.prepare('UPDATE automations SET name = ?, enabled = ?, trigger_type = ?, trigger_params = ?, actions = ? WHERE id = ? AND guild_id = ?');
const deleteAutomationStmt = db.prepare('DELETE FROM automations WHERE id = ? AND guild_id = ?');
const selectAutomation = db.prepare('SELECT * FROM automations WHERE id = ? AND guild_id = ?');
const selectAutomations = db.prepare('SELECT * FROM automations WHERE guild_id = ? ORDER BY created_at');
const selectAutomationsByTrigger = db.prepare('SELECT * FROM automations WHERE guild_id = ? AND trigger_type = ? AND enabled = 1');
const bumpAutomationFire = db.prepare('UPDATE automations SET last_fired_at = ?, fire_count = fire_count + 1 WHERE id = ?');
const parseAutomation = (r) => (r ? {
  ...r,
  enabled: !!r.enabled,
  trigger_params: safeParse(r.trigger_params, {}),
  actions: safeParse(r.actions, []),
} : null);

export function getAutomations(guildId) {
  return selectAutomations.all(guildId).map(parseAutomation);
}
export function getAutomation(guildId, id) {
  return parseAutomation(selectAutomation.get(id, guildId));
}
export function getEnabledAutomationsForTrigger(guildId, triggerType) {
  return selectAutomationsByTrigger.all(guildId, triggerType).map(parseAutomation);
}
export function createAutomation(guildId, { name, enabled, trigger_type, trigger_params, actions }) {
  const id = Number(insertAutomation.run(
    guildId,
    String(name || 'New automation').slice(0, 120),
    enabled === false ? 0 : 1,
    String(trigger_type || ''),
    JSON.stringify(trigger_params || {}),
    JSON.stringify(Array.isArray(actions) ? actions : []),
    Date.now(),
  ).lastInsertRowid);
  return getAutomation(guildId, id);
}
export function updateAutomation(guildId, id, { name, enabled, trigger_type, trigger_params, actions }) {
  updateAutomationStmt.run(
    String(name || 'Automation').slice(0, 120),
    enabled === false ? 0 : 1,
    String(trigger_type || ''),
    JSON.stringify(trigger_params || {}),
    JSON.stringify(Array.isArray(actions) ? actions : []),
    id, guildId,
  );
  return getAutomation(guildId, id);
}
export function deleteAutomation(guildId, id) {
  return deleteAutomationStmt.run(id, guildId).changes;
}
export function recordAutomationFire(id) {
  bumpAutomationFire.run(Date.now(), id);
}

// --- welcome-channel landing page (Mee6-style multi-element welcome page) ---
const DEFAULT_WELCOME_PAGE = {
  channel_id: null,
  elements: [],     // array of { type:'banner'|'section'|'columns', ... }
  message_ids: [],  // parallel to elements; the discord message id for each element after publish
};
function mergeWelcomePage(saved) {
  return {
    channel_id: saved?.channel_id ?? null,
    elements: Array.isArray(saved?.elements) ? saved.elements : [],
    message_ids: Array.isArray(saved?.message_ids) ? saved.message_ids : [],
  };
}
export function getWelcomePage(guildId) {
  return mergeWelcomePage(safeParse(getConfig(guildId).welcome_page, {}));
}
export function setWelcomePage(guildId, obj) {
  const merged = mergeWelcomePage({ ...getWelcomePage(guildId), ...obj });
  setConfigValue(guildId, 'welcome_page', JSON.stringify(merged));
  return merged;
}

// --- applications ---
const insertApplication = db.prepare('INSERT INTO applications (guild_id, user_id, user_tag, answers, created_at) VALUES (?, ?, ?, ?, ?)');
const selectApplication = db.prepare('SELECT * FROM applications WHERE id = ?');
const selectApplications = db.prepare('SELECT * FROM applications WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100');
const selectPendingByUser = db.prepare("SELECT * FROM applications WHERE guild_id = ? AND user_id = ? AND status = 'pending'");
const setApplicationStatus = db.prepare('UPDATE applications SET status = ? WHERE id = ?');
const parseApp = (r) => (r ? { ...r, answers: safeParse(r.answers, []) } : null);
export function createApplication(guildId, userId, userTag, answers) {
  return Number(insertApplication.run(guildId, userId, userTag ?? null, JSON.stringify(answers), Date.now()).lastInsertRowid);
}
export function getApplication(id) { return parseApp(selectApplication.get(id)); }
export function getApplications(guildId) { return selectApplications.all(guildId).map(parseApp); }
export function getPendingApplication(guildId, userId) { return parseApp(selectPendingByUser.get(guildId, userId)); }
export function setAppStatus(id, status) { return setApplicationStatus.run(status, id).changes; }

export default db;
