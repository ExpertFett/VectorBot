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
  getTrapLeaderboard, getRecentTraps,
  getBombLeaderboard, getRecentBombs, getSortieLeaderboard, getRecentSorties,
  getRoster, setRosterEntry, deleteRoster,
  getRecruitment, setRecruitment, getApplications,
  getOnboarding, setOnboarding,
} from '../db/index.js';
import { getBaseUrl } from './oauth.js';
import { buildEmbed } from '../util/embed.js';
import { postRoleMenu } from '../features/roleMenus.js';
import { postVerifyPanel } from '../features/verification.js';
import { postTicketPanel } from '../features/tickets.js';
import { postGiveaway, endGiveawayAndAnnounce, rerollGiveaway } from '../features/giveaways.js';
import { postEvent } from '../features/events.js';
import { postRecruitPanel } from '../features/recruitment.js';
import { postOnboardPanel } from '../features/onboarding.js';
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
    res.json({ ...req.session.user, selectedGuildId: req.session.guildId || null });
  });

  // Logged-in routes below (no specific server required yet).
  router.use(requireAuth);

  // Servers the user manages, flagged by whether the bot is present.
  router.get('/guilds', (req, res) => {
    const servers = (req.session.manageable || []).map((g) => ({ ...g, present: client.guilds.cache.has(g.id) }));
    res.json({
      servers,
      inviteBase: process.env.DISCORD_CLIENT_ID
        ? `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`
        : null,
    });
  });

  // Choose the active server for this session.
  router.post('/select-guild', (req, res) => {
    const guildId = cleanId(req.body?.guild_id);
    const manages = (req.session.manageable || []).some((g) => g.id === guildId);
    if (!guildId || !manages) return res.status(403).json({ error: 'no_access' });
    if (!client.guilds.cache.has(guildId)) return res.status(400).json({ error: 'bot_not_in_guild' });
    req.session.guildId = guildId;
    res.json({ ok: true, guildId });
  });

  // Everything below requires an active server the user manages and the bot is in.
  const requireGuild = (req, res, next) => {
    const gid = req.session.guildId;
    if (gid && (req.session.manageable || []).some((g) => g.id === gid) && client.guilds.cache.has(gid)) {
      req.guildId = gid;
      return next();
    }
    return res.status(409).json({ error: 'no_guild_selected' });
  };
  router.use(requireGuild);

  // Guild metadata for pickers (channels, roles)
  router.get('/guild', (req, res) => {
    const guild = client.guilds.cache.get(req.guildId);
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

  router.put('/config', (req, res) => {
    const b = req.body || {};
    const textCols = ['welcome_message', 'goodbye_message'];
    const idCols = ['welcome_channel_id', 'goodbye_channel_id', 'autorole_id', 'log_channel_id', 'invite_log_channel', 'status_channel_id', 'dcs_feed_channel_id'];

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

  // --- custom commands ---
  router.get('/commands', (req, res) => {
    res.json(getAllCustomCommands(req.guildId).map((r) => ({ ...r, embed: parseJson(r.embed) })));
  });

  router.put('/commands/:name', (req, res) => {
    const name = String(req.params.name).toLowerCase();
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'invalid_name' });
    const { response = null, embed = null } = req.body || {};
    if (!response && !embed) return res.status(400).json({ error: 'empty_command' });
    setCustomCommand(req.guildId, name, { response, embed: serialize(embed) }, req.session.user.id);
    res.json({ ok: true, name });
  });

  router.delete('/commands/:name', (req, res) => {
    const removed = removeCustomCommand(req.guildId, String(req.params.name).toLowerCase());
    res.json({ ok: removed > 0 });
  });

  // --- send an embed/message to a channel right now ---
  router.post('/announce', async (req, res) => {
    const { channel_id, content, embed } = req.body || {};
    const channel = client.channels.cache.get(cleanId(channel_id));
    if (!channel?.isTextBased() || channel.guildId !== req.guildId) return res.status(400).json({ error: 'invalid_channel' });

    const payload = {};
    if (content) payload.content = String(content);
    const built = embed ? buildEmbed(embed, undefined, getPersonalization(req.guildId).embed_color ?? undefined) : null;
    if (built) payload.embeds = [built];
    if (!payload.content && !payload.embeds) return res.status(400).json({ error: 'empty_message' });

    try {
      await channel.send(payload);
      res.json({ ok: true });
    } catch (err) {
      console.error('Announce failed:', err.message);
      res.status(500).json({ error: 'send_failed' });
    }
  });

  // --- auto-moderation ---
  router.get('/automod', (req, res) => res.json(getAutomod(req.guildId)));
  router.put('/automod', (req, res) => res.json(setAutomod(req.guildId, req.body || {})));

  // --- role menus ---
  router.get('/role-menus', (req, res) => res.json(getAllRoleMenus(req.guildId)));

  router.post('/role-menus', (req, res) => {
    const { title = '', description = '', channel_id = null, buttons = [], type = 'buttons', max_values = 1, embed = null } = req.body || {};
    const id = createRoleMenu(req.guildId, { title, description, channel_id: cleanId(channel_id), buttons, type, max_values, embed });
    res.json(getRoleMenu(id));
  });

  router.put('/role-menus/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = getRoleMenu(id);
    if (!existing || existing.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    const { title = '', description = '', channel_id = null, buttons = [], type = 'buttons', max_values = 1, embed = null } = req.body || {};
    res.json(updateRoleMenu(id, req.guildId, { title, description, channel_id: cleanId(channel_id), buttons, type, max_values, embed }));
  });

  router.delete('/role-menus/:id', (req, res) => {
    res.json({ ok: deleteRoleMenu(Number(req.params.id), req.guildId) > 0 });
  });

  router.post('/role-menus/:id/post', async (req, res) => {
    const id = Number(req.params.id);
    const menu = getRoleMenu(id);
    if (!menu || menu.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    if (!menu.channel_id) return res.status(400).json({ error: 'no_channel' });
    if (!(menu.buttons || []).some((b) => b.role_id)) {
      return res.status(400).json({ error: 'Add at least one button with a role selected, then Save, before posting.' });
    }
    try {
      const messageId = await postRoleMenu(client, menu);
      res.json({ ok: true, message_id: messageId });
    } catch (err) {
      console.error('Post role menu failed:', err.message);
      res.status(500).json({ error: err.message === 'invalid_channel' ? 'invalid_channel' : 'post_failed' });
    }
  });

  // --- moderation panel ---
  router.get('/modlog', (req, res) => res.json(getModLog(req.guildId, 100)));

  router.get('/warnings', (req, res) => {
    const guild = client.guilds.cache.get(req.guildId);
    const tag = (id) => guild?.members.cache.get(id)?.user?.tag || null;
    res.json(getAllWarnings(req.guildId).map((w) => ({
      ...w,
      user_tag: tag(w.user_id),
      moderator_tag: tag(w.moderator_id),
    })));
  });

  router.delete('/warnings/:id', (req, res) => {
    res.json({ ok: deleteWarningById(req.guildId, Number(req.params.id)) > 0 });
  });

  router.post('/warnings/clear', (req, res) => {
    const userId = cleanId(req.body?.user_id);
    if (!userId) return res.status(400).json({ error: 'missing_user' });
    res.json({ cleared: clearWarnings(req.guildId, userId) });
  });

  // --- verification ---
  router.get('/verification', (req, res) => res.json(getVerification(req.guildId)));
  router.put('/verification', (req, res) => {
    const b = req.body || {};
    res.json(setVerification(req.guildId, {
      enabled: !!b.enabled,
      channel_id: cleanId(b.channel_id),
      role_id: cleanId(b.role_id),
      title: b.title ?? '', description: b.description ?? '', button_label: b.button_label ?? 'Verify',
    }));
  });
  router.post('/verification/post', async (req, res) => {
    try { res.json({ ok: true, message_id: await postVerifyPanel(client, req.guildId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // --- tickets ---
  router.get('/tickets', (req, res) => res.json(getTicketsConfig(req.guildId)));
  router.put('/tickets', (req, res) => {
    const b = req.body || {};
    res.json(setTicketsConfig(req.guildId, {
      enabled: !!b.enabled,
      panel_channel_id: cleanId(b.panel_channel_id),
      category_id: cleanId(b.category_id),
      support_role_id: cleanId(b.support_role_id),
      title: b.title ?? '', description: b.description ?? '', button_label: b.button_label ?? 'Open Ticket',
      open_message: b.open_message ?? '',
    }));
  });
  router.post('/tickets/post', async (req, res) => {
    try { res.json({ ok: true, message_id: await postTicketPanel(client, req.guildId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // --- scheduled messages ---
  router.get('/scheduled', (req, res) => res.json(getScheduledAll(req.guildId)));

  const computeNextRun = (b) => {
    if (b.type === 'interval') return Date.now() + Math.max(60, Number(b.interval_seconds) || 3600) * 1000;
    const t = b.run_at ? new Date(b.run_at).getTime() : Date.now();
    return Number.isFinite(t) ? t : Date.now();
  };

  router.post('/scheduled', (req, res) => {
    const b = req.body || {};
    if (!cleanId(b.channel_id)) return res.status(400).json({ error: 'missing_channel' });
    if (!b.content && !b.embed) return res.status(400).json({ error: 'empty_message' });
    const id = createScheduled(req.guildId, {
      channel_id: cleanId(b.channel_id), content: b.content || null, embed: b.embed || null,
      type: b.type === 'interval' ? 'interval' : 'once',
      interval_seconds: b.type === 'interval' ? Math.max(60, Number(b.interval_seconds) || 3600) : null,
      next_run: computeNextRun(b), enabled: b.enabled !== false,
    });
    res.json({ ok: true, id });
  });

  router.put('/scheduled/:id', (req, res) => {
    const b = req.body || {};
    updateScheduled(Number(req.params.id), req.guildId, {
      channel_id: cleanId(b.channel_id), content: b.content || null, embed: b.embed || null,
      type: b.type === 'interval' ? 'interval' : 'once',
      interval_seconds: b.type === 'interval' ? Math.max(60, Number(b.interval_seconds) || 3600) : null,
      next_run: computeNextRun(b), enabled: b.enabled !== false,
    });
    res.json({ ok: true });
  });

  router.delete('/scheduled/:id', (req, res) => res.json({ ok: deleteScheduled(Number(req.params.id), req.guildId) > 0 }));

  // --- sticky messages ---
  router.get('/stickies', (req, res) => res.json(getStickies(req.guildId)));
  router.put('/stickies', (req, res) => {
    const b = req.body || {};
    const channelId = cleanId(b.channel_id);
    if (!channelId) return res.status(400).json({ error: 'missing_channel' });
    res.json(setSticky(req.guildId, channelId, { content: b.content || null, embed: b.embed || null, enabled: b.enabled !== false }));
  });
  router.delete('/stickies/:channelId', (req, res) =>
    res.json({ ok: deleteSticky(cleanId(req.params.channelId), req.guildId) > 0 }));

  // --- giveaways ---
  router.get('/giveaways', (req, res) =>
    res.json(getGiveaways(req.guildId).map((g) => ({ ...g, entries: getGiveawayEntryCount(g.id) }))));

  router.post('/giveaways', async (req, res) => {
    const b = req.body || {};
    const channelId = cleanId(b.channel_id);
    if (!channelId || !b.prize || !b.duration_seconds) return res.status(400).json({ error: 'missing_fields' });
    const id = createGiveaway(req.guildId, {
      channel_id: channelId, prize: String(b.prize), winners: Math.max(1, Number(b.winners) || 1),
      ends_at: Date.now() + Math.max(30, Number(b.duration_seconds)) * 1000, host_id: req.session.user.id,
      image: b.image || null, description: b.description || null,
    });
    try {
      await postGiveaway(client, getGiveaway(id));
      res.json({ ok: true, id });
    } catch (err) {
      deleteGiveaway(id, req.guildId);
      res.status(400).json({ error: err.message === 'invalid_channel' ? 'invalid_channel' : 'post_failed' });
    }
  });

  router.post('/giveaways/:id/end', async (req, res) => {
    const g = getGiveaway(Number(req.params.id));
    if (!g || g.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    if (g.ended) return res.status(400).json({ error: 'already_ended' });
    res.json({ winners: await endGiveawayAndAnnounce(client, g) });
  });

  router.post('/giveaways/:id/reroll', async (req, res) => {
    const g = getGiveaway(Number(req.params.id));
    if (!g || g.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    res.json({ winners: await rerollGiveaway(client, g) });
  });

  router.delete('/giveaways/:id', (req, res) => res.json({ ok: deleteGiveaway(Number(req.params.id), req.guildId) > 0 }));

  // --- youtube notifications ---
  router.get('/youtube', (req, res) => res.json(getYoutubeSubs(req.guildId)));
  router.post('/youtube', (req, res) => {
    const b = req.body || {};
    const ytId = String(b.youtube_channel_id || '').trim();
    const discordChannel = cleanId(b.discord_channel_id);
    if (!/^UC[\w-]{20,}$/.test(ytId)) return res.status(400).json({ error: 'invalid_youtube_id' });
    if (!discordChannel) return res.status(400).json({ error: 'missing_channel' });
    const id = createYoutubeSub(req.guildId, { youtube_channel_id: ytId, discord_channel_id: discordChannel, mention_role_id: cleanId(b.mention_role_id) });
    res.json({ ok: true, id });
  });
  router.delete('/youtube/:id', (req, res) => res.json({ ok: deleteYoutubeSub(Number(req.params.id), req.guildId) > 0 }));

  // --- social alerts (reddit / rss / twitch / kick) ---
  router.get('/social', (req, res) => res.json(getSocialSubs(req.guildId)));
  router.post('/social', (req, res) => {
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
  router.delete('/social/:id', (req, res) => res.json({ ok: deleteSocialSub(Number(req.params.id), req.guildId) > 0 }));

  // --- stats counter channels ---
  router.get('/stats', (req, res) => res.json(getStatChannels(req.guildId)));
  router.post('/stats', async (req, res) => {
    const type = req.body?.type || 'members';
    const template = (req.body?.template || 'Members: {count}').slice(0, 90);
    if (!STAT_TYPES.includes(type)) return res.status(400).json({ error: 'invalid_type' });
    const guild = client.guilds.cache.get(req.guildId);
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
  router.delete('/stats/:id', async (req, res) => {
    const s = getStatChannels(req.guildId).find((x) => x.id === Number(req.params.id));
    deleteStatChannel(Number(req.params.id), req.guildId);
    if (s) { const ch = client.channels.cache.get(s.channel_id); if (ch) await ch.delete('Stat channel removed').catch(() => {}); }
    res.json({ ok: true });
  });

  // --- invite tracker ---
  router.get('/invites', (req, res) => {
    const guild = client.guilds.cache.get(req.guildId);
    const tag = (id) => guild?.members.cache.get(id)?.user?.tag || null;
    res.json(getInviteLeaderboard(req.guildId).map((r) => ({ ...r, tag: tag(r.inviter_id) })));
  });

  // --- personalizer ---
  router.get('/personalizer', (req, res) => res.json(getPersonalization(req.guildId)));
  router.put('/personalizer', async (req, res) => {
    const b = req.body || {};
    const saved = setPersonalization(req.guildId, {
      bot_nickname: b.bot_nickname ? String(b.bot_nickname).slice(0, 32) : null,
      embed_color: Number.isFinite(b.embed_color) ? b.embed_color : null,
    });
    const guild = client.guilds.cache.get(req.guildId);
    if (guild?.members?.me) {
      try { await guild.members.me.setNickname(saved.bot_nickname || null); } catch { /* missing perm */ }
    }
    res.json(saved);
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

  router.post('/events', (req, res) => {
    const b = req.body || {};
    if (!b.title || !b.start_at) return res.status(400).json({ error: 'missing_fields' });
    const start = new Date(b.start_at).getTime();
    if (!Number.isFinite(start)) return res.status(400).json({ error: 'bad_date' });
    const id = createEvent(req.guildId, {
      channel_id: cleanId(b.channel_id), title: String(b.title), description: b.description || null,
      mission: b.mission || null, map: b.map || null, image: b.image || null,
      start_at: start, reminder_minutes: Math.max(0, Number(b.reminder_minutes) || 0),
      roles: sanitizeRoles(b.roles), embed: b.embed || null,
      waitlist: !!b.waitlist, multi_signup: !!b.multi_signup,
      recur_days: Math.max(0, Number(b.recur_days) || 0),
      created_by: req.session.user.id,
    });
    res.json({ ok: true, id });
  });

  router.put('/events/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = getEvent(id);
    if (!existing || existing.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const start = new Date(b.start_at).getTime();
    if (!b.title || !Number.isFinite(start)) return res.status(400).json({ error: 'bad_input' });
    updateEvent(id, req.guildId, {
      channel_id: cleanId(b.channel_id), title: String(b.title), description: b.description || null,
      mission: b.mission || null, map: b.map || null, image: b.image || null,
      start_at: start, reminder_minutes: Math.max(0, Number(b.reminder_minutes) || 0),
      roles: sanitizeRoles(b.roles), embed: b.embed || null,
      waitlist: !!b.waitlist, multi_signup: !!b.multi_signup,
      recur_days: Math.max(0, Number(b.recur_days) || 0),
    });
    res.json({ ok: true });
  });

  router.post('/events/:id/post', async (req, res) => {
    const event = getEvent(Number(req.params.id));
    if (!event || event.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    if (!event.channel_id) return res.status(400).json({ error: 'no_channel' });
    try { res.json({ ok: true, message_id: await postEvent(client, event) }); }
    catch (err) { res.status(400).json({ error: err.message === 'invalid_channel' ? 'invalid_channel' : 'post_failed' }); }
  });

  router.post('/events/:id/cancel', async (req, res) => {
    const event = getEvent(Number(req.params.id));
    if (!event || event.guild_id !== req.guildId) return res.status(404).json({ error: 'not_found' });
    setEventStatus(event.id, req.guildId, 'cancelled');
    try { if (event.message_id) await postEvent(client, getEvent(event.id)); } catch { /* ignore */ }
    res.json({ ok: true });
  });

  router.delete('/events/:id', (req, res) => res.json({ ok: deleteEvent(Number(req.params.id), req.guildId) > 0 }));

  // --- DCS server ingest config ---
  router.get('/dcs', (req, res) => {
    const token = getIngestToken(req.guildId);
    const c = getConfig(req.guildId);
    res.json({
      ingest_url: `${getBaseUrl()}/ingest/${token}`,
      status: getServerStatus(req.guildId),
      status_channel_id: c.status_channel_id || null,
      dcs_feed_channel_id: c.dcs_feed_channel_id || null,
    });
  });
  router.post('/dcs/regen', (req, res) => {
    const token = regenerateIngestToken(req.guildId);
    res.json({ ingest_url: `${getBaseUrl()}/ingest/${token}` });
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
    const guild = client.guilds.cache.get(req.guildId);
    if (!guild) return res.status(503).json({ error: 'bot_not_in_guild' });
    try {
      const members = await guild.members.fetch();
      res.json(members.filter((m) => !m.user.bot).map((m) => ({ id: m.id, tag: m.user.tag, name: m.displayName })).slice(0, 2000));
    } catch { res.status(500).json({ error: 'fetch_failed' }); }
  });

  router.put('/roster/:userId', (req, res) => {
    const userId = cleanId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'bad_user' });
    const b = req.body || {};
    setRosterEntry(req.guildId, userId, { callsign: b.callsign || null, airframes: b.airframes || null, quals: b.quals || null, notes: b.notes || null });
    res.json({ ok: true });
  });

  router.delete('/roster/:userId', (req, res) => res.json({ ok: deleteRoster(req.guildId, cleanId(req.params.userId)) > 0 }));

  // --- recruitment ---
  router.get('/recruitment', (req, res) => res.json(getRecruitment(req.guildId)));
  router.put('/recruitment', (req, res) => {
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
  router.post('/recruitment/post', async (req, res) => {
    try { res.json({ ok: true, message_id: await postRecruitPanel(client, req.guildId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.get('/applications', (req, res) => res.json(getApplications(req.guildId)));

  // --- onboarding wizard ---
  router.get('/onboarding', (req, res) => res.json(getOnboarding(req.guildId)));
  router.put('/onboarding', (req, res) => {
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
  router.post('/onboarding/post', async (req, res) => {
    try { res.json({ ok: true, message_id: await postOnboardPanel(client, req.guildId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post('/roster/import', async (req, res) => {
    const rows = parseCsv(req.body?.csv || '');
    if (!rows.length) return res.status(400).json({ error: 'empty_csv' });
    let members = null;
    if (rows.some((r) => !r.user_id && (r.username || r.name))) {
      members = await client.guilds.cache.get(req.guildId)?.members.fetch().catch(() => null);
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

  return router;
}
