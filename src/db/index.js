import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.env.DB_PATH || './data/bot.db';
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

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

const ALLOWED_CONFIG_COLUMNS = new Set([
  'welcome_channel_id', 'welcome_message', 'welcome_embed',
  'goodbye_channel_id', 'goodbye_message', 'goodbye_embed',
  'autorole_id', 'log_channel_id', 'automod',
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
  'INSERT INTO role_menus (guild_id, channel_id, title, description, buttons, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const selectRoleMenu = db.prepare('SELECT * FROM role_menus WHERE id = ?');
const selectRoleMenus = db.prepare('SELECT * FROM role_menus WHERE guild_id = ? ORDER BY created_at DESC');
const deleteRoleMenuStmt = db.prepare('DELETE FROM role_menus WHERE id = ? AND guild_id = ?');
const setRoleMenuMsgStmt = db.prepare('UPDATE role_menus SET channel_id = ?, message_id = ? WHERE id = ?');
const updateRoleMenuStmt = db.prepare(
  'UPDATE role_menus SET title = ?, description = ?, buttons = ?, channel_id = ? WHERE id = ? AND guild_id = ?'
);

const parseMenu = (row) => (row ? { ...row, buttons: safeParse(row.buttons, []) } : null);
const safeParse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

export function createRoleMenu(guildId, { channel_id = null, title = '', description = '', buttons = [] }) {
  const info = insertRoleMenu.run(guildId, channel_id, title, description, JSON.stringify(buttons), Date.now());
  return Number(info.lastInsertRowid);
}
export function getRoleMenu(id) { return parseMenu(selectRoleMenu.get(id)); }
export function getAllRoleMenus(guildId) { return selectRoleMenus.all(guildId).map(parseMenu); }
export function updateRoleMenu(id, guildId, { title, description, buttons, channel_id }) {
  updateRoleMenuStmt.run(title, description, JSON.stringify(buttons || []), channel_id, id, guildId);
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

export default db;
