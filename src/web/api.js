import { Router, raw } from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  getConfig, setConfigValue,
  getAllCustomCommands, setCustomCommand, removeCustomCommand,
  getAutomod, setAutomod,
  getAllRoleMenus, getRoleMenu, createRoleMenu, updateRoleMenu, deleteRoleMenu,
  getModLog, getAllWarnings, deleteWarningById, clearWarnings,
  getVerification, setVerification,
  getTicketsConfig, setTicketsConfig,
  createScheduled, getScheduledAll, updateScheduled, deleteScheduled,
  getStickies, setSticky, deleteSticky,
  createGiveaway, getGiveaways, getGiveaway, deleteGiveaway, getGiveawayEntryCount,
  getYoutubeSubs, createYoutubeSub, deleteYoutubeSub,
  createSocialSub, getSocialSubs, deleteSocialSub,
  createStatChannel, getStatChannels, deleteStatChannel,
  getInviteLeaderboard, getPersonalization, setPersonalization,
  createEvent, getEvent, getEvents, updateEvent, deleteEvent, setEventStatus, getSignups,
  getIngestToken, regenerateIngestToken, getServerStatus,
  getReadyroomOutboundToken, regenerateReadyroomOutboundToken,
  getTrapLeaderboard, getRecentTraps,
  getBombLeaderboard, getRecentBombs, getSortieLeaderboard, getRecentSorties,
  getRoster, setRosterEntry, deleteRoster,
  getRecruitment, setRecruitment, getApplications,
  getOnboarding, setOnboarding,
  getWelcomePage, setWelcomePage,
  getAccessGroups, getAccessGroup, createAccessGroup, updateAccessGroupRow, deleteAccessGroup,
  getPermissionOverrides, setPermissionOverrides,
  getAutomations, getAutomation, createAutomation, updateAutomation, deleteAutomation,
  getDashboardAccess, setDashboardAccess,
} from '../db/index.js';
import { ACTIONS } from '../access/registry.js';
import { TRIGGERS, ACTIONS as AUTO_ACTIONS, TRIGGER_BY_KEY, ACTION_BY_KEY } from '../automations/registry.js';
import { getBaseUrl } from './oauth.js';
import {
  getCustomBotToken, setCustomBotToken,
  createSentEmbed, getSentEmbed, getSentEmbeds, updateSentEmbed, deleteSentEmbed,
  logWelcome, getWelcomeLog, getWelcomeLogEntry, deleteWelcomeLogEntry,
} from '../db/index.js';
import { applyPlaceholders } from '../util/format.js';
import {
  startCustomBot, stopCustomBot, getBotForGuild, isGuildReachable, getCustomBotStatus,
} from '../customBots/index.js';
import { buildEmbed } from '../util/embed.js';
import { canPerform } from '../access/check.js';
import { normalizeMentions } from '../util/mentions.js';
import { postRoleMenu } from '../features/roleMenus.js';
import { postVerifyPanel } from '../features/verification.js';
import { postTicketPanel } from '../features/tickets.js';
import { postGiveaway, endGiveawayAndAnnounce, rerollGiveaway } from '../features/giveaways.js';
import { postEvent } from '../features/events.js';
import { postRecruitPanel } from '../features/recruitment.js';
import { postOnboardPanel } from '../features/onboarding.js';
import { publishWelcomePage, clearWelcomePage } from '../features/welcomePage.js';
import { computeAnalytics } from '../features/analytics.js';
import { buildInstallerZip, CURRENT_HOOK_VERSION } from '../features/dcsInstaller.js';
import { parseMizSlots } from '../features/mizParser.js';
import { STAT_TYPES, computeStat } from '../features/stats.js';
import { requireAuth } from './auth.js';

const NAME_RE = /^[a-z0-9_-]{1,32}$/;
// Invite permissions incl. Manage Channels (tickets/stats), Manage Roles, moderation, etc.
const INVITE_PERMISSIONS = '1099780156438';

const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const serialize = (v) => (v ? JSON.stringify(v) : null);
const cleanId = (v) => (v ? String(v).replace(/[^0-9]/g, '') || null : null);

// Minimal CSV parser (handles quoted fields with commas/quotes). Returns row objects keyed by lowercased header.
function parseCsv(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] ?? ''; });
    return row;
  });
}

export function apiRouter(client) {
  const router = Router();

  router.get('/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'unauthorized' });
    const access = req.session.guildAccess;
    const out = { ...req.session.user, selectedGuildId: req.session.guildId || null };
    // Only attach the permissions map once a guild is selected. Lets the
    // frontend hide tabs the current user can't access in this guild.
    if (req.session.guildId && access) {
      const member = {
        id: req.session.user.id,
        guildId: req.session.guildId,
        isOwner: !!access.isOwner,
        isAdmin: !!access.isAdmin,
        roleIds: Array.isArray(access.roleIds) ? access.roleIds : [],
      };
      out.access = { mode: access.mode, isAdmin: !!access.isAdmin, isOwner: !!access.isOwner };
      out.permissions = Object.fromEntries(ACTIONS.map((a) => [a.key, canPerform(member, a.key)]));
    }
    res.json(out);
  });

  // Logged-in routes below (no specific server required yet).
  router.use(requireAuth);

  // Helper: figure out whether the session user can reach `guildId`. Multiple
  // paths grant access, in order:
  //   1. They're the server owner → always
  //   2. The guild's dashboard-admin role list includes one of their roles → admin
  //   3. Discord Manage Server (in OAuth `manageable`) AND the guild has the
  //      "Manage Server grants dashboard admin" toggle on (default) → admin
  //   4. They hold a role in at least one Access Group with any granted
  //      permission → limited groups access
  // Returns the access shape we cache on the session, or null if no path matches.
  const resolveGuildAccess = async (req, guildId) => {
    const sess = req.session || {};
    const discordAdmin = (sess.manageable || []).some((g) => g.id === guildId);
    const dashCfg = getDashboardAccess(guildId);

    // Fast path for a pure-Discord-admin who isn't also expected to hold the
    // bot-admin role: if Manage Server still grants admin, accept immediately.
    // The bot.members.fetch we'd otherwise do is non-trivial latency on every
    // guild-switch — keep it lazy.
    if (discordAdmin && dashCfg.discord_admin_grants && !dashCfg.admin_role_ids.length) {
      return { mode: 'admin', isAdmin: true, isOwner: false, roleIds: [] };
    }

    // For every other path we need the member's actual role IDs.
    if (!(sess.userGuildIds || []).includes(guildId)) return null;
    const bot = getBotForGuild(guildId, client);
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) return null;
    const member = await guild.members.fetch(sess.user.id).catch(() => null);
    if (!member) return null;
    const roleIds = [...member.roles.cache.keys()];
    const isOwner = guild.ownerId === member.id;
    if (isOwner) return { mode: 'owner', isAdmin: false, isOwner: true, roleIds };

    // (2) Bot-admin role list → full dashboard admin.
    if (dashCfg.admin_role_ids.length && roleIds.some((rid) => dashCfg.admin_role_ids.includes(rid))) {
      return { mode: 'admin', isAdmin: true, isOwner: false, roleIds };
    }
    // (3) Manage Server still grants admin (when configured admin role list is
    // present, we already passed it without matching, so Discord-admin alone
    // counts only when the toggle is on).
    if (discordAdmin && dashCfg.discord_admin_grants) {
      return { mode: 'admin', isAdmin: true, isOwner: false, roleIds };
    }

    // (4) Limited Access Groups path.
    const memberLight = { id: member.id, guildId, isOwner, isAdmin: false, roleIds };
    const anyPermitted = ACTIONS.some((a) => canPerform(memberLight, a.key));
    if (!anyPermitted) return null;
    return { mode: 'groups', isAdmin: false, isOwner: false, roleIds };
  };

  // Servers the user can reach. Two categories:
  //   1. Discord-admin (Manage Server) guilds where the bot ISN'T present —
  //      shown so the user can invite the bot from the picker. We don't
  //      verify "bot would actually grant them admin" here — there's no
  //      dashboard config yet for a guild without the bot. The Discord-admin
  //      flag is enough to surface the guild for the invite flow.
  //   2. Guilds where the bot IS present — full resolveGuildAccess so the
  //      bot-admin role list / Manage-Server toggle / Access Groups are
  //      honoured. A Discord-admin who's been locked out via those settings
  //      won't appear via this path.
  router.get('/guilds', async (req, res) => {
    const manageable = req.session.manageable || [];
    const userGuildIds = req.session.userGuildIds || [];
    const seen = new Set();
    const servers = [];

    // (1) Invite-candidates: Discord-admin guilds the bot isn't in yet.
    for (const g of manageable) {
      if (!isGuildReachable(g.id, client)) {
        seen.add(g.id);
        servers.push({
          id: g.id,
          name: g.name,
          icon: g.icon,
          access: 'admin',
          present: false,
        });
      }
    }

    // (2) Bot-present guilds with any access path under the configured rules.
    for (const gid of userGuildIds) {
      if (seen.has(gid)) continue;
      if (!isGuildReachable(gid, client)) continue;
      const access = await resolveGuildAccess(req, gid).catch(() => null);
      if (access && (access.mode === 'admin' || access.mode === 'groups' || access.mode === 'owner')) {
        const bot = getBotForGuild(gid, client);
        const guild = bot.guilds.cache.get(gid);
        if (guild) {
          seen.add(gid);
          servers.push({
            id: gid,
            name: guild.name,
            icon: guild.iconURL({ size: 64 }),
            access: access.mode,
            present: true,
          });
        }
      }
    }
    res.json({
      servers,
      inviteBase: process.env.DISCORD_CLIENT_ID
        ? `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`
        : null,
    });
  });

  // Choose the active server for this session.
  router.post('/select-guild', async (req, res) => {
    const guildId = cleanId(req.body?.guild_id);
    if (!guildId) return res.status(400).json({ error: 'no_guild_id' });
    const access = await resolveGuildAccess(req, guildId);
    if (!access) return res.status(403).json({ error: 'no_access' });
    if (!isGuildReachable(guildId, client)) return res.status(400).json({ error: 'bot_not_in_guild' });
    req.session.guildId = guildId;
    req.session.guildAccess = access; // {mode, isAdmin, isOwner, roleIds}
    res.json({ ok: true, guildId, access: access.mode });
  });

  // Everything below requires an active server the user can reach.
  const requireGuild = (req, res, next) => {
    const gid = req.session.guildId;
    const access = req.session.guildAccess;
    if (!gid || !access) return res.status(409).json({ error: 'no_guild_selected' });
    if (client.isReady() && !isGuildReachable(gid, client)) {
      return res.status(400).json({ error: 'bot_not_in_guild' });
    }
    req.guildId = gid;
    // Light member shape for canPerform() — sourced from cached session info,
    // refreshed only when the user re-selects the guild. Trade: a role change
    // on Discord takes a re-select to reflect in dashboard perms.
    req.member = {
      id: req.session.user.id,
      guildId: gid,
      isOwner: !!access.isOwner,
      isAdmin: !!access.isAdmin,
      roleIds: Array.isArray(access.roleIds) ? access.roleIds : [],
    };
    next();
  };
  router.use(requireGuild);

  // Per-action gate. Drop this BEFORE the route handler to enforce that the
  // session user has permission for `actionKey`. Admins/owner short-circuit.
  const requireAction = (actionKey) => (req, res, next) => {
    if (canPerform(req.member, actionKey)) return next();
    res.status(403).json({ error: 'forbidden', action: actionKey });
  };
  // Admin-only gate. Use for routes that should NEVER be opened up through
  // Access Groups — Access Groups management itself, custom-bot tokens,
  // anything that could let a member escalate their own permissions.
  const requireAdmin = (req, res, next) => {
    if (req.member?.isAdmin || req.member?.isOwner) return next();
    res.status(403).json({ error: 'admin_only' });
  };

  // Guild metadata for pickers (channels, roles)
  router.get('/guild', async (req, res) => {
    // The bot's guild cache populates a few seconds after a deploy. Wait briefly
    // so this endpoint succeeds and the Events / Welcome / etc. pages don't
    // half-load (their Promise.all in the dashboard rejects on a single 503).
    // Wait briefly for any of our bots (main or custom) to have the guild in
    // cache after a restart.
    const haveGuild = () => isGuildReachable(req.guildId, client);
    if (!haveGuild()) {
      const start = Date.now();
      while (Date.now() - start < 8000 && !haveGuild()) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    // Prefer the custom bot's view if it's running — its perms / role hierarchy
    // are what actually matter for that guild's operations.
    const bot = getBotForGuild(req.guildId, client);
    const guild = bot.guilds.cache.get(req.guildId);
    if (!guild) return res.status(503).json({ error: 'bot_not_in_guild_yet' });

    const channels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));

    const categories = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name }));

    const me = guild.members.me;
    const roles = guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        assignable: me ? r.position < me.roles.highest.position : false,
      }));

    res.json({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ size: 128 }),
      memberCount: guild.memberCount,
      channels,
      categories,
      roles,
    });
  });

  // --- config ---
  router.get('/config', (req, res) => {
    const c = getConfig(req.guildId);
    res.json({
      ...c,
      welcome_embed: parseJson(c.welcome_embed),
      goodbye_embed: parseJson(c.goodbye_embed),
      status_embed: parseJson(c.status_embed),
    });
  });

  router.put('/config', requireAction('welcome.manage'), (req, res) => {
    const b = req.body || {};
    const textCols = ['welcome_message', 'goodbye_message', 'readyroom_ingest_url'];
    const idCols = ['welcome_channel_id', 'goodbye_channel_id', 'autorole_id', 'log_channel_id', 'invite_log_channel', 'status_channel_id', 'dcs_feed_channel_id', 'readyroom_events_channel_id'];

    for (const col of idCols) if (col in b) setConfigValue(req.guildId, col, cleanId(b[col]));
    for (const col of textCols) if (col in b) setConfigValue(req.guildId, col, b[col] ? String(b[col]) : null);
    if ('welcome_embed' in b) setConfigValue(req.guildId, 'welcome_embed', serialize(b.welcome_embed));
    if ('goodbye_embed' in b) setConfigValue(req.guildId, 'goodbye_embed', serialize(b.goodbye_embed));
    if ('status_embed' in b) setConfigValue(req.guildId, 'status_embed', serialize(b.status_embed));

    const c = getConfig(req.guildId);
    res.json({
      ...c,
      welcome_embed: parseJson(c.welcome_embed),
      goodbye_embed: parseJson(c.goodbye_embed),
      status_embed: parseJson(c.status_embed),
    });
  });

  // --- welcome / goodbye: test sends + recent-post log ---
  // Posts the configured welcome OR goodbye message to its channel right now,
  // using the requesting admin as the "joining/leaving member" so they can
  // verify it looks right without needing a real member event.
  router.post('/welcome/test', requireAction('welcome.manage'), async (req, res) => {
    const kind = req.body?.kind === 'goodbye' ? 'goodbye' : 'welcome';
    const cfg = getConfig(req.guildId);
    const channelKey = kind === 'goodbye' ? 'goodbye_channel_id' : 'welcome_channel_id';
    const messageKey = kind === 'goodbye' ? 'goodbye_message' : 'welcome_message';
    const embedKey = kind === 'goodbye' ? 'goodbye_embed' : 'welcome_embed';

    if (!cfg[channelKey]) return res.status(400).json({ error: 'Pick a channel and message for ' + kind + ' before testing.' });
    if (!cfg[messageKey] && !cfg[embedKey]) return res.status(400).json({ error: 'Add a message or embed for ' + kind + ' before testing.' });

    const bot = getBotForGuild(req.guildId, client);
    const guild = bot.guilds.cache.get(req.guildId);
    if (!guild) return res.status(503).json({ error: 'guild_not_ready' });
    const member = await guild.members.fetch(req.session.user.id).catch(() => null);
    if (!member) return res.status(400).json({ error: 'You aren’t a member of this server, so I can’t use you as the test member.' });

    const channel = bot.channels.cache.get(cfg[channelKey])
      || (await bot.channels.fetch(cfg[channelKey]).catch(() => null));
    if (!channel?.isTextBased()) return res.status(400).json({ error: 'invalid_channel' });

    const sub = (s) => applyPlaceholders(s, { member, guild, mention: kind === 'welcome' });
    const payload = {};
    if (cfg[messageKey]) payload.content = `🧪 *Test ${kind}* — ` + sub(cfg[messageKey]);
    const embedJson = parseJson(cfg[embedKey]);
    const accent = getPersonalization(req.guildId).embed_color ?? undefined;
    const builtEmbed = embedJson ? buildEmbed(embedJson, sub, accent) : null;
    if (builtEmbed) payload.embeds = [builtEmbed];

    try {
      const sent = await channel.send(payload);
      logWelcome(req.guildId, {
        kind, user_id: member.id, user_tag: member.user.tag,
        channel_id: channel.id, message_id: sent.id, test: true,
      });
      res.json({ ok: true, message_id: sent.id });
    } catch (err) {
      console.error(`${kind} test failed:`, err.message);
      res.status(500).json({ error: 'send_failed', detail: err.message });
    }
  });

  router.get('/welcome/log', (req, res) => res.json(getWelcomeLog(req.guildId)));

  router.delete('/welcome/log/:id', requireAction('welcome.manage'), async (req, res) => {
    const id = Number(req.params.id);
    const entry = getWelcomeLogEntry(id, req.guildId);
    if (!entry) return res.status(404).json({ error: 'not_found' });
    // Best-effort delete the Discord message; drop the row either way.
    if (entry.message_id) {
      const bot = getBotForGuild(req.guildId, client);
      const channel = bot.channels.cache.get(entry.channel_id)
        || (await bot.channels.fetch(entry.channel_id).catch(() => null));
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(entry.message_id).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    }
    deleteWelcomeLogEntry(id, req.guildId);
    res.json({ ok: true });
  });

  // --- custom commands ---
  router.get('/commands', (req, res) => {
    res.json(getAllCustomCommands(req.guildId).map((r) => ({ ...r, embed: parseJson(r.embed) })));
  });

  router.put('/commands/:name', requireAdmin, (req, res) => {
    const name = String(req.params.name).toLowerCase();
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'invalid_name' });
    const { response = null, embed = null } = req.body || {};
    if (!response && !embed) return res.status(400).json({ error: 'empty_command' });
    setCustomCommand(req.guildId, name, { response, embed: serialize(embed) }, req.session.user.id);
    res.json({ ok: true, name });
  });

  router.delete('/commands/:name', requireAdmin, (req, res) => {
    const removed = removeCustomCommand(req.guildId, String(req.params.name).toLowerCase());
    res.json({ ok: removed > 0 });
  });

  // --- send an embed/message to a channel right now ---
  router.post('/announce', requireAction('announcements.send'), async (req, res) => {
    const { channel_id, content, embed, mentions } = req.body || {};
    const cleanCh = cleanId(channel_id);
    const channel = getBotForGuild(req.guildId, client).channels.cache.get(cleanCh);
    if (!channel?.isTextBased() || channel.guildId !== req.guildId) return res.status(400).json({ error: 'invalid_channel' });

    const payload = {};
    if (content) payload.content = String(content);
    const built = embed ? buildEmbed(embed, undefined, getPersonalization(req.guildId).embed_color ?? undefined) : null;
    if (built) payload.embeds = [built];
    applyMentions(payload, mentions);   // prepend role/@everyone pings + set allowedMentions
    if (!payload.content && !payload.embeds) return res.status(400).json({ error: 'empty_message' });

    try {
      const sent = await channel.send(payload);
      // Save so it can be edited / deleted from the dashboard later.
      const id = createSentEmbed(req.guildId, {
        channel_id: cleanCh, message_id: sent.id,
        content: content || null, embed: embed || null,
        created_by: req.session.user?.id || null,
      });
      res.json({ ok: true, id, message_id: sent.id });
    } catch (err) {
      console.error('Announce failed:', err.message);
      res.status(500).json({ error: 'send_failed' });
    }
  });

  // --- sent embed history (edit / delete after the fact) ---
  router.get('/embeds', (req, res) => res.json(getSentEmbeds(req.guildId)));

  router.put('/embeds/:id', requireAction('announcements.send'), async (req, res) => {
    const id = Number(req.params.id);
    const existing = getSentEmbed(id, req.guildId);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { content, embed } = req.body || {};
    if (!content && !embed) return res.status(400).json({ error: 'empty_message' });

    const bot = getBotForGuild(req.guildId, client);
    const channel = bot.channels.cache.get(existing.channel_id)
      || (await bot.channels.fetch(existing.channel_id).catch(() => null));
    if (!channel?.isTextBased()) return res.status(400).json({ error: 'invalid_channel' });
    const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (!msg) return res.status(404).json({ error: 'message_gone', detail: 'The original message is no longer in Discord. Delete this record and send a new one.' });

    const payload = { content: content || '', embeds: [] };
    const built = embed ? buildEmbed(embed, undefined, getPersonalization(req.guildId).embed_color ?? undefined) : null;
    if (built) payload.embeds = [built];

    try {
      await msg.edit(payload);
      updateSentEmbed(id, req.guildId, { content: content || null, embed: embed || null });
      res.json({ ok: true });
    } catch (err) {
      console.error('Embed edit failed:', err.message);
      res.status(500).json({ error: 'edit_failed', detail: err.message });
    }
  });

  router.delete('/embeds/:id', requireAction('announcements.send'), async (req, res) => {
    const id = Number(req.params.id);
    const existing = getSentEmbed(id, req.guildId);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // Best-effort delete the Discord message; either way drop the DB row.
    const bot = getBotForGuild(req.guildId, client);
    const channel = bot.channels.cache.get(existing.channel_id)
      || (await bot.channels.fetch(existing.channel_id).catch(() => null));
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
    }
    deleteSentEmbed(id, req.guildId);
    res.json({ ok: true });
  });

  // --- auto-moderation ---
  router.get('/automod', (req, res) => res.json(getAutomod(req.guildId)));
  router.put('/automod', requireAction('automod.manage'), (req, res) => res.json(setAutomod(req.guildId, req.body || {})));

  // --- role menus ---
  router.get('/role-menus', (req, res) => res.json(getAllRoleMenus(req.guildId)));

  router.post('/role-menus', requireAction('rolemenus.manage'), (req, res) => {
    const { title = '', description = '', channel_id = null, buttons = [], type = 'buttons', max_values = 1, embed = null } = req.body || {};
    const id = createRoleMenu(req.guildId, { title, description, channel_id: cleanId(channel_id), buttons, type, max_values, embed });
    res.json(getRoleMenu(id));
  });

  router.put('/role-menus/:id', requireAction('rolemenus.manage'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getRoleMenu(id);
    if (!existing || existing.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    const { title = '', description = '', channel_id = null, buttons = [], type = 'buttons', max_values = 1, embed = null } = req.body || {};
    res.json(updateRoleMenu(id, req.guildId, { title, description, channel_id: cleanId(channel_id), buttons, type, max_values, embed }));
  });

  router.delete('/role-menus/:id', requireAction('rolemenus.manage'), (req, res) => {
    res.json({ ok: deleteRoleMenu(Number(req.params.id), req.guildId) > 0 });
  });

  router.post('/role-menus/:id/post', requireAction('rolemenus.manage'), async (req, res) => {
    const id = Number(req.params.id);
    const menu = getRoleMenu(id);
    if (!menu || menu.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    if (!menu.channel_id) return res.status(400).json({ error: 'no_channel' });
    if (!(menu.buttons || []).some((b) => b.role_id)) {
      return res.status(400).json({ error: 'Add at least one button with a role selected, then Save, before posting.' });
    }
    try {
      const messageId = await postRoleMenu(getBotForGuild(req.guildId, client), menu);
      res.json({ ok: true, message_id: messageId });
    } catch (err) {
      console.error('Post role menu failed:', err.message);
      res.status(500).json({ error: err.message === 'invalid_channel' ? 'invalid_channel' : 'post_failed' });
    }
  });

  // --- moderation panel ---
  router.get('/modlog', (req, res) => res.json(getModLog(req.guildId, 100)));

  router.get('/warnings', (req, res) => {
    const guild = getBotForGuild(req.guildId, client).guilds.cache.get(req.guildId);
    const tag = (id) => guild?.members.cache.get(id)?.user?.tag || null;
    res.json(getAllWarnings(req.guildId).map((w) => ({
      ...w,
      user_tag: tag(w.user_id),
      moderator_tag: tag(w.moderator_id),
    })));
  });

  router.delete('/warnings/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteWarningById(req.guildId, Number(req.params.id)) > 0 });
  });

  router.post('/warnings/clear', requireAdmin, (req, res) => {
    const userId = cleanId(req.body?.user_id);
    if (!userId) return res.status(400).json({ error: 'missing_user' });
    res.json({ cleared: clearWarnings(req.guildId, userId) });
  });

  // --- verification ---
  router.get('/verification', (req, res) => res.json(getVerification(req.guildId)));
  router.put('/verification', requireAction('verification.manage'), (req, res) => {
    const b = req.body || {};
    res.json(setVerification(req.guildId, {
      enabled: !!b.enabled,
      channel_id: cleanId(b.channel_id),
      role_id: cleanId(b.role_id),
      title: b.title ?? '', description: b.description ?? '', button_label: b.button_label ?? 'Verify',
      embed: b.embed || null,
    }));
  });
  router.post('/verification/post', requireAction('verification.manage'), async (req, res) => {
    const cfg = getVerification(req.guildId);
    if (!cfg.channel_id) return res.status(400).json({ error: 'Pick a channel before posting.' });
    if (!cfg.role_id) return res.status(400).json({ error: 'Pick a "Role granted" before posting — the verify button needs a role to grant.' });
    // Posting the panel implies the maker wants the gate active. Auto-enable so
    // clicking the button doesn't surface "verification isn't set up".
    if (!cfg.enabled) setVerification(req.guildId, { enabled: true });
    try { res.json({ ok: true, message_id: await postVerifyPanel(getBotForGuild(req.guildId, client), req.guildId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // --- tickets ---
  router.get('/tickets', (req, res) => res.json(getTicketsConfig(req.guildId)));
  router.put('/tickets', requireAction('tickets.manage'), (req, res) => {
    const b = req.body || {};
    res.json(setTicketsConfig(req.guildId, {
      enabled: !!b.enabled,
      panel_channel_id: cleanId(b.panel_channel_id),
      category_id: cleanId(b.category_id),
      support_role_id: cleanId(b.support_role_id),
      title: b.title ?? '', description: b.description ?? '', button_label: b.button_label ?? 'Open Ticket',
      open_message: b.open_message ?? '',
      embed: b.embed || null,
    }));
  });
  router.post('/tickets/post', requireAction('tickets.manage'), async (req, res) => {
    const cfg = getTicketsConfig(req.guildId);
    if (!cfg.panel_channel_id) return res.status(400).json({ error: 'Pick a panel channel before posting.' });
    if (!cfg.enabled) setTicketsConfig(req.guildId, { enabled: true });
    try { res.json({ ok: true, message_id: await postTicketPanel(getBotForGuild(req.guildId, client), req.guildId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // --- scheduled messages ---
  router.get('/scheduled', (req, res) => res.json(getScheduledAll(req.guildId)));

  const computeNextRun = (b) => {
    if (b.type === 'interval') return Date.now() + Math.max(60, Number(b.interval_seconds) || 3600) * 1000;
    const t = b.run_at ? new Date(b.run_at).getTime() : Date.now();
    return Number.isFinite(t) ? t : Date.now();
  };

  router.post('/scheduled', requireAction('scheduled.create'), (req, res) => {
    const b = req.body || {};
    if (!cleanId(b.channel_id)) return res.status(400).json({ error: 'missing_channel' });
    if (!b.content && !b.embed) return res.status(400).json({ error: 'empty_message' });
    const id = createScheduled(req.guildId, {
      channel_id: cleanId(b.channel_id), content: b.content || null, embed: b.embed || null,
      type: b.type === 'interval' ? 'interval' : 'once',
      interval_seconds: b.type === 'interval' ? Math.max(60, Number(b.interval_seconds) || 3600) : null,
      next_run: computeNextRun(b), enabled: b.enabled !== false,
      mentions: normalizeMentions(b.mentions),
    });
    res.json({ ok: true, id });
  });

  router.put('/scheduled/:id', requireAction('scheduled.create'), (req, res) => {
    const b = req.body || {};
    updateScheduled(Number(req.params.id), req.guildId, {
      channel_id: cleanId(b.channel_id), content: b.content || null, embed: b.embed || null,
      type: b.type === 'interval' ? 'interval' : 'once',
      interval_seconds: b.type === 'interval' ? Math.max(60, Number(b.interval_seconds) || 3600) : null,
      next_run: computeNextRun(b), enabled: b.enabled !== false,
      mentions: normalizeMentions(b.mentions),
    });
    res.json({ ok: true });
  });

  router.delete('/scheduled/:id', requireAction('scheduled.create'), (req, res) => res.json({ ok: deleteScheduled(Number(req.params.id), req.guildId) > 0 }));

  // --- sticky messages ---
  router.get('/stickies', (req, res) => res.json(getStickies(req.guildId)));
  router.put('/stickies', requireAction('sticky.set'), (req, res) => {
    const b = req.body || {};
    const channelId = cleanId(b.channel_id);
    if (!channelId) return res.status(400).json({ error: 'missing_channel' });
    res.json(setSticky(req.guildId, channelId, { content: b.content || null, embed: b.embed || null, enabled: b.enabled !== false }));
  });
  router.delete('/stickies/:channelId', requireAction('sticky.set'), (req, res) =>
    res.json({ ok: deleteSticky(cleanId(req.params.channelId), req.guildId) > 0 }));

  // --- giveaways ---
  router.get('/giveaways', (req, res) =>
    res.json(getGiveaways(req.guildId).map((g) => ({ ...g, entries: getGiveawayEntryCount(g.id) }))));

  router.post('/giveaways', requireAction('giveaways.create'), async (req, res) => {
    const b = req.body || {};
    const channelId = cleanId(b.channel_id);
    if (!channelId || !b.prize || !b.duration_seconds) return res.status(400).json({ error: 'missing_fields' });
    const id = createGiveaway(req.guildId, {
      channel_id: channelId, prize: String(b.prize), winners: Math.max(1, Number(b.winners) || 1),
      ends_at: Date.now() + Math.max(30, Number(b.duration_seconds)) * 1000, host_id: req.session.user.id,
      image: b.image || null, description: b.description || null,
    });
    try {
      await postGiveaway(getBotForGuild(req.guildId, client), getGiveaway(id));
      res.json({ ok: true, id });
    } catch (err) {
      deleteGiveaway(id, req.guildId);
      res.status(400).json({ error: err.message === 'invalid_channel' ? 'invalid_channel' : 'post_failed' });
    }
  });

  router.post('/giveaways/:id/end', requireAction('giveaways.create'), async (req, res) => {
    const g = getGiveaway(Number(req.params.id));
    if (!g || g.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    if (g.ended) return res.status(400).json({ error: 'already_ended' });
    res.json({ winners: await endGiveawayAndAnnounce(getBotForGuild(req.guildId, client), g) });
  });

  router.post('/giveaways/:id/reroll', requireAction('giveaways.create'), async (req, res) => {
    const g = getGiveaway(Number(req.params.id));
    if (!g || g.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    res.json({ winners: await rerollGiveaway(getBotForGuild(req.guildId, client), g) });
  });

  router.delete('/giveaways/:id', requireAction('giveaways.create'), (req, res) => res.json({ ok: deleteGiveaway(Number(req.params.id), req.guildId) > 0 }));

  // --- youtube notifications ---
  router.get('/youtube', (req, res) => res.json(getYoutubeSubs(req.guildId)));
  router.post('/youtube', requireAdmin, (req, res) => {
    const b = req.body || {};
    const ytId = String(b.youtube_channel_id || '').trim();
    const discordChannel = cleanId(b.discord_channel_id);
    if (!/^UC[\w-]{20,}$/.test(ytId)) return res.status(400).json({ error: 'invalid_youtube_id' });
    if (!discordChannel) return res.status(400).json({ error: 'missing_channel' });
    const id = createYoutubeSub(req.guildId, { youtube_channel_id: ytId, discord_channel_id: discordChannel, mention_role_id: cleanId(b.mention_role_id) });
    res.json({ ok: true, id });
  });
  router.delete('/youtube/:id', requireAdmin, (req, res) => res.json({ ok: deleteYoutubeSub(Number(req.params.id), req.guildId) > 0 }));

  // --- social alerts (reddit / rss / twitch / kick) ---
  router.get('/social', (req, res) => res.json(getSocialSubs(req.guildId)));
  router.post('/social', requireAdmin, (req, res) => {
    const b = req.body || {};
    const platform = b.platform;
    const query = String(b.query || '').trim().replace(/^\/?r\//i, ''); // tolerate "r/foo"
    const channel = cleanId(b.discord_channel_id);
    if (!['reddit', 'rss', 'twitch', 'kick', 'youtube'].includes(platform) || !query) return res.status(400).json({ error: 'invalid' });
    if (!channel) return res.status(400).json({ error: 'missing_channel' });
    if (platform === 'twitch' && (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET)) {
      return res.status(400).json({ error: 'twitch_not_configured' });
    }
    const id = createSocialSub(req.guildId, { platform, query, discord_channel_id: channel, mention_role_id: cleanId(b.mention_role_id) });
    res.json({ ok: true, id });
  });
  router.delete('/social/:id', requireAdmin, (req, res) => res.json({ ok: deleteSocialSub(Number(req.params.id), req.guildId) > 0 }));

  // --- stats counter channels ---
  router.get('/stats', (req, res) => res.json(getStatChannels(req.guildId)));
  router.post('/stats', requireAdmin, async (req, res) => {
    const type = req.body?.type || 'members';
    const template = (req.body?.template || 'Members: {count}').slice(0, 90);
    if (!STAT_TYPES.includes(type)) return res.status(400).json({ error: 'invalid_type' });
    const guild = getBotForGuild(req.guildId, client).guilds.cache.get(req.guildId);
    if (!guild) return res.status(503).json({ error: 'bot_not_in_guild' });
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return res.status(400).json({ error: 'I need the “Manage Channels” permission to create counter channels.' });
    }
    try {
      const value = computeStat(guild, type, null);
      const channel = await guild.channels.create({
        name: template.replace('{count}', value.toLocaleString()),
        type: ChannelType.GuildVoice,
      });
      // Best-effort: stop members joining the display-only counter (needs Manage Roles).
      channel.permissionOverwrites.edit(guild.id, { Connect: false }).catch(() => {});
      const id = createStatChannel(req.guildId, { channel_id: channel.id, type, template });
      res.json({ ok: true, id });
    } catch (err) {
      console.error('Stat channel create failed:', err.message);
      res.status(500).json({ error: err.message || 'create_failed' });
    }
  });
  router.delete('/stats/:id', requireAdmin, async (req, res) => {
    const s = getStatChannels(req.guildId).find((x) => x.id === Number(req.params.id));
    deleteStatChannel(Number(req.params.id), req.guildId);
    if (s) { const ch = getBotForGuild(req.guildId, client).channels.cache.get(s.channel_id); if (ch) await ch.delete('Stat channel removed').catch(() => {}); }
    res.json({ ok: true });
  });

  // --- invite tracker ---
  router.get('/invites', (req, res) => {
    const guild = getBotForGuild(req.guildId, client).guilds.cache.get(req.guildId);
    const tag = (id) => guild?.members.cache.get(id)?.user?.tag || null;
    res.json(getInviteLeaderboard(req.guildId).map((r) => ({ ...r, tag: tag(r.inviter_id) })));
  });

  // --- personalizer ---
  router.get('/personalizer', (req, res) => res.json(getPersonalization(req.guildId)));
  router.put('/personalizer', requireAction('personalizer.manage'), async (req, res) => {
    const b = req.body || {};
    const saved = setPersonalization(req.guildId, {
      bot_nickname: b.bot_nickname ? String(b.bot_nickname).slice(0, 32) : null,
      embed_color: Number.isFinite(b.embed_color) ? b.embed_color : null,
    });
    const bot = getBotForGuild(req.guildId, client);
    const guild = bot.guilds.cache.get(req.guildId);
    if (guild?.members?.me) {
      try { await guild.members.me.setNickname(saved.bot_nickname || null); } catch { /* missing perm */ }
    }
    res.json(saved);
  });

  // --- custom (per-guild) bot ---
  // Status + minimal identity for the "Customize" page.
  router.get('/custom-bot', (req, res) => {
    const token = getCustomBotToken(req.guildId);
    res.json({
      configured: !!token,
      ...getCustomBotStatus(req.guildId),
    });
  });

  // Save a new token + boot the custom client. Validates the token by actually
  // logging in — if Discord rejects it we tell the user instead of silently
  // storing junk.
  router.put('/custom-bot', requireAdmin, async (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (token.length < 50) return res.status(400).json({ error: 'invalid_token' });
    try {
      const c = await startCustomBot(req.guildId, token);
      // Only persist once login + ready succeed.
      setCustomBotToken(req.guildId, token);
      res.json({ ok: true, bot_tag: c.user?.tag || null, bot_id: c.user?.id || null });
    } catch (err) {
      console.error('Custom bot start failed:', err.message);
      // Make sure no half-spawned client lingers.
      try { await stopCustomBot(req.guildId); } catch { /* ignore */ }
      res.status(400).json({ error: 'login_failed', detail: err.message });
    }
  });

  router.delete('/custom-bot', requireAdmin, async (req, res) => {
    try { await stopCustomBot(req.guildId); } catch { /* ignore */ }
    setCustomBotToken(req.guildId, null);
    res.json({ ok: true });
  });

  // --- events (mission scheduler) ---
  const sanitizeRoles = (roles) => (Array.isArray(roles) ? roles : [])
    .filter((r) => r && r.label)
    .slice(0, 100)
    .map((r) => ({
      label: String(r.label).slice(0, 80),
      emoji: r.emoji ? String(r.emoji).slice(0, 64) : '',
      limit: Math.max(0, Number(r.limit) || 0),
      group: r.group ? String(r.group).slice(0, 80) : '',
      qual: r.qual ? String(r.qual).slice(0, 40) : '',
    }));

  // {flight: tasking} — only keep entries for flights that actually exist
  // in the roles list, and trim values.
  const sanitizeTaskings = (taskings, roles) => {
    if (!taskings || typeof taskings !== 'object') return {};
    const flights = new Set(roles.map((r) => r.group).filter(Boolean));
    const out = {};
    for (const [k, v] of Object.entries(taskings)) {
      if (!flights.has(k) || !v) continue;
      out[k] = String(v).slice(0, 30).toUpperCase().trim();
      if (!out[k]) delete out[k];
    }
    return out;
  };

  // Parse an uploaded .miz (raw binary body) into flyable slots for the sign-up sheet.
  router.post('/events/parse-miz', raw({ type: '*/*', limit: '12mb' }), (req, res) => {
    try {
      const slots = parseMizSlots(req.body);
      res.json({ slots });
    } catch (err) {
      res.status(400).json({ error: err.message || 'parse_failed' });
    }
  });

  router.get('/events', (req, res) =>
    res.json(getEvents(req.guildId).map((e) => ({ ...e, signups: getSignups(e.id) }))));

  router.post('/events', requireAction('events.manage'), (req, res) => {
    const b = req.body || {};
    if (!b.title || !b.start_at) return res.status(400).json({ error: 'missing_fields' });
    const start = new Date(b.start_at).getTime();
    if (!Number.isFinite(start)) return res.status(400).json({ error: 'bad_date' });
    const roles = sanitizeRoles(b.roles);
    const id = createEvent(req.guildId, {
      channel_id: cleanId(b.channel_id), title: String(b.title), description: b.description || null,
      mission: b.mission || null, map: b.map || null, image: b.image || null,
      start_at: start, reminder_minutes: Math.max(0, Number(b.reminder_minutes) || 0),
      roles, embed: b.embed || null,
      waitlist: !!b.waitlist, multi_signup: !!b.multi_signup,
      recur_days: Math.max(0, Number(b.recur_days) || 0),
      taskings: sanitizeTaskings(b.taskings, roles),
      mentions: normalizeMentions(b.mentions),
      created_by: req.session.user.id,
    });
    res.json({ ok: true, id });
  });

  router.put('/events/:id', requireAction('events.manage'), async (req, res) => {
    const id = Number(req.params.id);
    const existing = getEvent(id);
    if (!existing || existing.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const start = new Date(b.start_at).getTime();
    if (!b.title || !Number.isFinite(start)) return res.status(400).json({ error: 'bad_input' });
    const roles = sanitizeRoles(b.roles);
    updateEvent(id, req.guildId, {
      channel_id: cleanId(b.channel_id), title: String(b.title), description: b.description || null,
      mission: b.mission || null, map: b.map || null, image: b.image || null,
      start_at: start, reminder_minutes: Math.max(0, Number(b.reminder_minutes) || 0),
      roles, embed: b.embed || null,
      waitlist: !!b.waitlist, multi_signup: !!b.multi_signup,
      recur_days: Math.max(0, Number(b.recur_days) || 0),
      taskings: sanitizeTaskings(b.taskings, roles),
      mentions: normalizeMentions(b.mentions),
    });
    // If this event was already posted, refresh the Discord embed automatically
    // so the maker doesn't have to also click "Post / Update in Discord". A
    // failure to repost (perms, channel changed, message deleted) doesn't fail
    // the save — they can fall back to the explicit Post button.
    let reposted = false;
    if (existing.message_id) {
      try { await postEvent(getBotForGuild(req.guildId, client), getEvent(id)); reposted = true; }
      catch (e) { console.error('Event auto-repost failed:', e.message); }
    }
    res.json({ ok: true, reposted });
  });

  router.post('/events/:id/post', requireAction('events.post'), async (req, res) => {
    const event = getEvent(Number(req.params.id));
    if (!event || event.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    if (!event.channel_id) return res.status(400).json({ error: 'no_channel' });
    try { res.json({ ok: true, message_id: await postEvent(getBotForGuild(req.guildId, client), event) }); }
    catch (err) { res.status(400).json({ error: err.message === 'invalid_channel' ? 'invalid_channel' : 'post_failed' }); }
  });

  router.post('/events/:id/cancel', requireAction('events.manage'), async (req, res) => {
    const event = getEvent(Number(req.params.id));
    if (!event || event.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    setEventStatus(event.id, req.guildId, 'cancelled');
    try { if (event.message_id) await postEvent(getBotForGuild(req.guildId, client), getEvent(event.id)); } catch { /* ignore */ }
    res.json({ ok: true });
  });

  router.delete('/events/:id', requireAction('events.manage'), (req, res) => res.json({ ok: deleteEvent(Number(req.params.id), req.guildId) > 0 }));

  // --- DCS server ingest config ---
  router.get('/dcs', (req, res) => {
    const token = getIngestToken(req.guildId);
    const c = getConfig(req.guildId);
    const status = getServerStatus(req.guildId);

    // Compute a plain-English connection health from the last-seen timestamp.
    //   connected : heard within 2 min
    //   stale     : heard before, but quiet for 2+ min (DCS closed / broke)
    //   never     : no heartbeat ever recorded
    const lastSeen = status?.updated_at || null;
    const age = lastSeen ? Date.now() - lastSeen : null;
    let health = 'never';
    if (lastSeen) health = age <= 120_000 ? 'connected' : 'stale';
    const hookVersion = status?.hook_version || null;

    res.json({
      ingest_url: `${getBaseUrl()}/ingest/${token}`,
      status,
      health,                                  // 'connected' | 'stale' | 'never'
      last_seen: lastSeen,                     // epoch ms or null
      hook_version: hookVersion,               // version the server last reported
      latest_hook_version: CURRENT_HOOK_VERSION,
      hook_outdated: !!(hookVersion && hookVersion !== CURRENT_HOOK_VERSION),
      status_channel_id: c.status_channel_id || null,
      dcs_feed_channel_id: c.dcs_feed_channel_id || null,
      readyroom_ingest_url: c.readyroom_ingest_url || null,
      readyroom_outbound_token: getReadyroomOutboundToken(req.guildId),
      readyroom_events_channel_id: c.readyroom_events_channel_id || null,
    });
  });
  router.post('/dcs/regen', requireAdmin, (req, res) => {
    const token = regenerateIngestToken(req.guildId);
    res.json({ ingest_url: `${getBaseUrl()}/ingest/${token}` });
  });
  router.post('/dcs/regen-readyroom-token', requireAdmin, (req, res) => {
    res.json({ readyroom_outbound_token: regenerateReadyroomOutboundToken(req.guildId) });
  });

  // Downloadable pre-configured installer zip for the DCS Lua hook. The zip
  // contains the .lua + .vbs + README with the ingest URL already baked in,
  // so the user just drops the three files into Saved Games\<DCS>\Scripts\Hooks
  // and restarts — no editing, no copy-pasting URLs.
  router.get('/dcs/installer.zip', (req, res) => {
    try {
      const token = getIngestToken(req.guildId);
      const ingestUrl = `${getBaseUrl()}/ingest/${token}`;
      const zip = buildInstallerZip(ingestUrl);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="dcsopt-installer.zip"');
      res.setHeader('Cache-Control', 'no-store');     // URLs are sensitive — never cache
      res.send(zip);
    } catch (err) {
      console.error('installer build failed:', err);
      res.status(500).json({ error: 'installer_failed', detail: err.message });
    }
  });

  router.get('/traps', (req, res) => res.json({
    leaderboard: getTrapLeaderboard(req.guildId),
    recent: getRecentTraps(req.guildId, 25),
  }));

  router.get('/bombs', (req, res) => res.json({
    leaderboard: getBombLeaderboard(req.guildId),
    recent: getRecentBombs(req.guildId, 25),
  }));

  router.get('/sorties', (req, res) => res.json({
    leaderboard: getSortieLeaderboard(req.guildId),
    recent: getRecentSorties(req.guildId, 25),
  }));

  // --- roster & quals ---
  router.get('/roster', (req, res) => res.json(getRoster(req.guildId)));

  router.get('/members', async (req, res) => {
    const guild = getBotForGuild(req.guildId, client).guilds.cache.get(req.guildId);
    if (!guild) return res.status(503).json({ error: 'bot_not_in_guild' });
    try {
      const members = await guild.members.fetch();
      res.json(members.filter((m) => !m.user.bot).map((m) => ({ id: m.id, tag: m.user.tag, name: m.displayName })).slice(0, 2000));
    } catch { res.status(500).json({ error: 'fetch_failed' }); }
  });

  router.put('/roster/:userId', requireAction('roster.manage'), (req, res) => {
    const userId = cleanId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'bad_user' });
    const b = req.body || {};
    setRosterEntry(req.guildId, userId, { callsign: b.callsign || null, airframes: b.airframes || null, quals: b.quals || null, notes: b.notes || null });
    res.json({ ok: true });
  });

  router.delete('/roster/:userId', requireAction('roster.manage'), (req, res) => res.json({ ok: deleteRoster(req.guildId, cleanId(req.params.userId)) > 0 }));

  // --- recruitment ---
  router.get('/recruitment', (req, res) => res.json(getRecruitment(req.guildId)));
  router.put('/recruitment', requireAction('recruitment.manage'), (req, res) => {
    const b = req.body || {};
    const questions = (Array.isArray(b.questions) ? b.questions : [])
      .filter((q) => q && q.label).slice(0, 5)
      .map((q) => ({ label: String(q.label).slice(0, 45), required: q.required !== false, paragraph: !!q.paragraph }));
    res.json(setRecruitment(req.guildId, {
      enabled: !!b.enabled,
      panel_channel_id: cleanId(b.panel_channel_id),
      review_channel_id: cleanId(b.review_channel_id),
      approve_role_id: cleanId(b.approve_role_id),
      title: b.title ?? '', description: b.description ?? '', button_label: b.button_label ?? 'Apply',
      embed: b.embed || null,
      questions,
    }));
  });
  router.post('/recruitment/post', requireAction('recruitment.manage'), async (req, res) => {
    const cfg = getRecruitment(req.guildId);
    if (!cfg.panel_channel_id) return res.status(400).json({ error: 'Pick a panel channel before posting.' });
    if (!cfg.enabled) setRecruitment(req.guildId, { enabled: true });
    try { res.json({ ok: true, message_id: await postRecruitPanel(getBotForGuild(req.guildId, client), req.guildId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.get('/applications', requireAction('recruitment.review'), (req, res) => res.json(getApplications(req.guildId)));

  // --- onboarding wizard ---
  router.get('/onboarding', (req, res) => res.json(getOnboarding(req.guildId)));
  router.put('/onboarding', requireAction('onboarding.manage'), (req, res) => {
    const b = req.body || {};
    const steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 10).map((s) => ({
      title: String(s?.title || '').slice(0, 256),
      description: String(s?.description || '').slice(0, 4000),
      image: (typeof s?.image === 'string' && /^https?:\/\//i.test(s.image)) ? s.image : null,
      roles: (Array.isArray(s?.roles) ? s.roles : [])
        .filter((r) => r && r.role_id).slice(0, 20)
        .map((r) => ({ role_id: cleanId(r.role_id), label: String(r.label || 'Role').slice(0, 80), emoji: r.emoji || null })),
    }));
    res.json(setOnboarding(req.guildId, {
      enabled: !!b.enabled,
      panel_channel_id: cleanId(b.panel_channel_id),
      completion_role_id: cleanId(b.completion_role_id),
      title: b.title ?? '', description: b.description ?? '', button_label: b.button_label ?? 'Get Started',
      finish_message: b.finish_message ?? '',
      embed: b.embed || null,
      steps,
    }));
  });
  router.post('/onboarding/post', requireAction('onboarding.manage'), async (req, res) => {
    const cfg = getOnboarding(req.guildId);
    if (!cfg.panel_channel_id) return res.status(400).json({ error: 'Pick a panel channel before posting.' });
    if (!cfg.enabled) setOnboarding(req.guildId, { enabled: true });
    try { res.json({ ok: true, message_id: await postOnboardPanel(getBotForGuild(req.guildId, client), req.guildId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // --- welcome-channel landing page (Mee6-style) ---
  router.get('/welcome-page', (req, res) => res.json(getWelcomePage(req.guildId)));
  router.put('/welcome-page', requireAction('welcomepage.manage'), (req, res) => {
    const b = req.body || {};
    const elements = (Array.isArray(b.elements) ? b.elements : []).slice(0, 25).map((el) => {
      const type = ['banner', 'section', 'columns'].includes(el?.type) ? el.type : 'section';
      const out = { type };
      if (type === 'banner') {
        out.title = String(el.title || '').slice(0, 256);
        out.image_url = (typeof el.image_url === 'string' && /^https?:\/\//i.test(el.image_url)) ? el.image_url : '';
      } else if (type === 'section') {
        out.title = String(el.title || '').slice(0, 256);
        out.description = String(el.description || '').slice(0, 4000);
        out.image_url = (typeof el.image_url === 'string' && /^https?:\/\//i.test(el.image_url)) ? el.image_url : '';
      } else if (type === 'columns') {
        out.title = String(el.title || '').slice(0, 256);
        const cols = Array.isArray(el.columns) ? el.columns : [];
        out.columns = cols.slice(0, 3).map((c) => ({
          heading: String(c?.heading || '').slice(0, 256),
          content: String(c?.content || '').slice(0, 1024),
        }));
      }
      return out;
    });
    res.json(setWelcomePage(req.guildId, {
      channel_id: cleanId(b.channel_id),
      elements,
    }));
  });
  router.post('/welcome-page/publish', requireAction('welcomepage.manage'), async (req, res) => {
    const cfg = getWelcomePage(req.guildId);
    if (!cfg.channel_id) return res.status(400).json({ error: 'Pick a channel before publishing.' });
    if (!cfg.elements?.length) return res.status(400).json({ error: 'Add at least one element before publishing.' });
    try {
      const out = await publishWelcomePage(getBotForGuild(req.guildId, client), req.guildId);
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  // --- Automations ---
  // Validate that an automation payload only uses known trigger/action keys
  // and that each carries its required params. Keeps junk out of the engine.
  const sanitizeAutomation = (b) => {
    const triggerType = String(b?.trigger_type || '');
    const trig = TRIGGER_BY_KEY[triggerType];
    if (!trig) throw new Error('unknown_trigger');
    const triggerParams = {};
    for (const p of trig.params) {
      const v = b?.trigger_params?.[p.key];
      if (p.required && (v === undefined || v === null || v === '')) throw new Error(`missing_trigger_param:${p.key}`);
      if (v !== undefined && v !== null) triggerParams[p.key] = (p.type === 'role' || p.type === 'channel') ? cleanId(v) : String(v).slice(0, 4000);
    }
    const actions = (Array.isArray(b?.actions) ? b.actions : []).slice(0, 10).map((a) => {
      const def = ACTION_BY_KEY[a?.type];
      if (!def) throw new Error('unknown_action');
      if (def.appliesTo && !def.appliesTo.includes(triggerType)) throw new Error(`action_incompatible:${a.type}`);
      const params = {};
      for (const p of def.params) {
        const v = a?.params?.[p.key];
        if (p.required && (v === undefined || v === null || v === '')) throw new Error(`missing_action_param:${a.type}/${p.key}`);
        if (v !== undefined && v !== null) params[p.key] = (p.type === 'role' || p.type === 'channel') ? cleanId(v) : String(v).slice(0, 4000);
      }
      return { type: a.type, params };
    });
    if (!actions.length) throw new Error('no_actions');
    return {
      name: String(b?.name || 'Automation').slice(0, 120),
      enabled: b?.enabled !== false,
      trigger_type: triggerType,
      trigger_params: triggerParams,
      actions,
    };
  };

  router.get('/automations/registry', (_req, res) => res.json({ triggers: TRIGGERS, actions: AUTO_ACTIONS }));
  router.get('/automations', requireAdmin, (req, res) => res.json(getAutomations(req.guildId)));
  router.post('/automations', requireAdmin, (req, res) => {
    try { res.json(createAutomation(req.guildId, sanitizeAutomation(req.body || {}))); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.put('/automations/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!getAutomation(req.guildId, id)) return res.status(404).json({ error: 'not_found' });
    try { res.json(updateAutomation(req.guildId, id, sanitizeAutomation(req.body || {}))); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.delete('/automations/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteAutomation(req.guildId, Number(req.params.id)) > 0 });
  });

  router.get('/analytics', requireAdmin, (req, res) => {
    try { res.json(computeAnalytics(req.guildId)); }
    catch (err) { console.error('analytics error:', err); res.status(500).json({ error: 'analytics_failed' }); }
  });

  router.post('/welcome-page/clear', requireAction('welcomepage.manage'), async (req, res) => {
    try { await clearWelcomePage(getBotForGuild(req.guildId, client), req.guildId); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // --- Access Groups + permission overrides ---
  // CRITICAL: every mutation route here MUST be admin-only. Otherwise a
  // member who's been granted one permission could grant themselves the rest.
  router.get('/access/actions', (_req, res) => res.json(ACTIONS));
  router.get('/access/groups', (req, res) => res.json(getAccessGroups(req.guildId)));
  router.post('/access/groups', requireAdmin, (req, res) => {
    const b = req.body || {};
    const role_ids = (Array.isArray(b.role_ids) ? b.role_ids : []).map(cleanId).filter(Boolean).slice(0, 50);
    const group = createAccessGroup(req.guildId, {
      name: String(b.name || 'New group').slice(0, 80),
      color: b.color || null,
      role_ids,
    });
    res.json(group);
  });
  router.put('/access/groups/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
    const existing = getAccessGroup(req.guildId, id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const role_ids = (Array.isArray(b.role_ids) ? b.role_ids : existing.role_ids).map(cleanId).filter(Boolean).slice(0, 50);
    const group = updateAccessGroupRow(req.guildId, id, {
      name: String(b.name ?? existing.name).slice(0, 80),
      color: b.color !== undefined ? b.color : existing.color,
      role_ids,
    });
    res.json(group);
  });
  router.delete('/access/groups/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const changes = deleteAccessGroup(req.guildId, id);
    // Also strip the deleted group from every permission override that referenced it.
    if (changes) {
      const overrides = getPermissionOverrides(req.guildId);
      let touched = false;
      for (const k of Object.keys(overrides)) {
        const before = overrides[k].group_ids?.length || 0;
        overrides[k] = { ...overrides[k], group_ids: (overrides[k].group_ids || []).filter((g) => g !== id) };
        if ((overrides[k].group_ids?.length || 0) !== before) touched = true;
      }
      if (touched) setPermissionOverrides(req.guildId, overrides);
    }
    res.json({ ok: true, deleted: changes });
  });

  router.get('/access/permissions', (req, res) => res.json(getPermissionOverrides(req.guildId)));
  router.put('/access/permissions', requireAdmin, (req, res) => {
    const validKeys = new Set(ACTIONS.map((a) => a.key));
    const filtered = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (validKeys.has(k)) filtered[k] = v;
    }
    res.json(setPermissionOverrides(req.guildId, filtered));
  });

  // Dashboard access settings — which roles grant full dashboard admin and
  // whether Discord's Manage Server permission still grants admin too.
  router.get('/access/dashboard', requireAdmin, (req, res) => res.json(getDashboardAccess(req.guildId)));
  router.put('/access/dashboard', requireAdmin, (req, res) => {
    const b = req.body || {};
    res.json(setDashboardAccess(req.guildId, {
      admin_role_ids: Array.isArray(b.admin_role_ids) ? b.admin_role_ids.map(cleanId).filter(Boolean) : [],
      discord_admin_grants: b.discord_admin_grants !== false,
    }));
  });

  router.post('/roster/import', requireAction('roster.manage'), async (req, res) => {
    const rows = parseCsv(req.body?.csv || '');
    if (!rows.length) return res.status(400).json({ error: 'empty_csv' });
    let members = null;
    if (rows.some((r) => !r.user_id && (r.username || r.name))) {
      members = await getBotForGuild(req.guildId, client).guilds.cache.get(req.guildId)?.members.fetch().catch(() => null);
    }
    let imported = 0;
    for (const r of rows) {
      let userId = cleanId(r.user_id);
      if (!userId && members) {
        const uname = (r.username || r.name || '').toLowerCase();
        const m = members.find((mm) => mm.user.username.toLowerCase() === uname || mm.displayName.toLowerCase() === uname);
        if (m) userId = m.id;
      }
      if (!userId) continue;
      setRosterEntry(req.guildId, userId, { callsign: r.callsign || null, airframes: r.airframes || null, quals: r.quals || null, notes: r.notes || null });
      imported++;
    }
    res.json({ ok: true, imported, total: rows.length });
  });

  // Change the bot's avatar — GLOBAL (one bot, one avatar across all servers), rate-limited.
  router.post('/bot-avatar', async (req, res) => {
    const url = req.body?.url;
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'invalid_url' });
    try {
      await client.user.setAvatar(url);
      res.json({ ok: true });
    } catch (err) {
      console.error('Avatar update failed:', err.message);
      res.status(400).json({ error: 'avatar_failed' });
    }
  });

  // Drag-and-drop image upload — raw image bytes in the body (any image/* type).
  // Uses its own raw body parser so we don't have to lift the global 256kb JSON
  // limit for one feature.
  router.post('/bot-avatar-upload', raw({ type: 'image/*', limit: '8mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'no_image' });
    }
    try {
      await client.user.setAvatar(req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error('Avatar upload failed:', err.message);
      res.status(400).json({ error: 'avatar_failed' });
    }
  });

  return router;
}
