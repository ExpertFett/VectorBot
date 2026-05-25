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
`);

// --- batch 5 schema (embed options + invite log) ---
ensureColumn('role_menus', 'embed', 'TEXT');          // optional custom embed JSON
ensureColumn('giveaways', 'image', 'TEXT');           // optional embed image
ensureColumn('giveaways', 'description', 'TEXT');     // optional extra description
ensureColumn('guild_config', 'invite_log_channel', 'TEXT');

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

export default db;
