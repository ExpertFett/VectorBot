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

const ALLOWED_CONFIG_COLUMNS = new Set([
  'welcome_channel_id', 'welcome_message',
  'goodbye_channel_id', 'goodbye_message',
  'autorole_id', 'log_channel_id',
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
  INSERT INTO custom_commands (guild_id, name, response, created_by, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, name) DO UPDATE SET response = excluded.response
`);
const selectCommand = db.prepare('SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?');
const selectCommands = db.prepare(
  'SELECT name FROM custom_commands WHERE guild_id = ? ORDER BY name ASC'
);
const deleteCommand = db.prepare('DELETE FROM custom_commands WHERE guild_id = ? AND name = ?');

export function setCustomCommand(guildId, name, response, createdBy) {
  upsertCommand.run(guildId, name, response, createdBy, Date.now());
}
export function getCustomCommand(guildId, name) {
  return selectCommand.get(guildId, name);
}
export function listCustomCommands(guildId) {
  return selectCommands.all(guildId).map((r) => r.name);
}
export function removeCustomCommand(guildId, name) {
  return deleteCommand.run(guildId, name).changes;
}

export default db;
