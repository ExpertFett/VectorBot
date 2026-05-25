import { Router } from 'express';
import { ChannelType } from 'discord.js';
import {
  getConfig, setConfigValue,
  getAllCustomCommands, setCustomCommand, removeCustomCommand,
  getAutomod, setAutomod,
  getAllRoleMenus, getRoleMenu, createRoleMenu, updateRoleMenu, deleteRoleMenu,
  getModLog, getAllWarnings, deleteWarningById, clearWarnings,
} from '../db/index.js';
import { buildEmbed } from '../util/embed.js';
import { postRoleMenu } from '../features/roleMenus.js';
import { requireAuth } from './auth.js';

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const NAME_RE = /^[a-z0-9_-]{1,32}$/;

const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const serialize = (v) => (v ? JSON.stringify(v) : null);
const cleanId = (v) => (v ? String(v).replace(/[^0-9]/g, '') || null : null);

export function apiRouter(client) {
  const router = Router();

  router.get('/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'unauthorized' });
    res.json(req.session.user);
  });

  // Everything below requires Manage Server on the configured guild.
  router.use(requireAuth);

  // Guild metadata for pickers (channels, roles)
  router.get('/guild', (req, res) => {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return res.status(503).json({ error: 'bot_not_in_guild_yet' });

    const channels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));

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
      roles,
    });
  });

  // --- config ---
  router.get('/config', (req, res) => {
    const c = getConfig(GUILD_ID);
    res.json({
      ...c,
      welcome_embed: parseJson(c.welcome_embed),
      goodbye_embed: parseJson(c.goodbye_embed),
    });
  });

  router.put('/config', (req, res) => {
    const b = req.body || {};
    const textCols = ['welcome_message', 'goodbye_message'];
    const idCols = ['welcome_channel_id', 'goodbye_channel_id', 'autorole_id', 'log_channel_id'];

    for (const col of idCols) if (col in b) setConfigValue(GUILD_ID, col, cleanId(b[col]));
    for (const col of textCols) if (col in b) setConfigValue(GUILD_ID, col, b[col] ? String(b[col]) : null);
    if ('welcome_embed' in b) setConfigValue(GUILD_ID, 'welcome_embed', serialize(b.welcome_embed));
    if ('goodbye_embed' in b) setConfigValue(GUILD_ID, 'goodbye_embed', serialize(b.goodbye_embed));

    const c = getConfig(GUILD_ID);
    res.json({
      ...c,
      welcome_embed: parseJson(c.welcome_embed),
      goodbye_embed: parseJson(c.goodbye_embed),
    });
  });

  // --- custom commands ---
  router.get('/commands', (req, res) => {
    res.json(getAllCustomCommands(GUILD_ID).map((r) => ({ ...r, embed: parseJson(r.embed) })));
  });

  router.put('/commands/:name', (req, res) => {
    const name = String(req.params.name).toLowerCase();
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'invalid_name' });
    const { response = null, embed = null } = req.body || {};
    if (!response && !embed) return res.status(400).json({ error: 'empty_command' });
    setCustomCommand(GUILD_ID, name, { response, embed: serialize(embed) }, req.session.user.id);
    res.json({ ok: true, name });
  });

  router.delete('/commands/:name', (req, res) => {
    const removed = removeCustomCommand(GUILD_ID, String(req.params.name).toLowerCase());
    res.json({ ok: removed > 0 });
  });

  // --- send an embed/message to a channel right now ---
  router.post('/announce', async (req, res) => {
    const { channel_id, content, embed } = req.body || {};
    const channel = client.channels.cache.get(cleanId(channel_id));
    if (!channel?.isTextBased()) return res.status(400).json({ error: 'invalid_channel' });

    const payload = {};
    if (content) payload.content = String(content);
    const built = embed ? buildEmbed(embed) : null;
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
  router.get('/automod', (req, res) => res.json(getAutomod(GUILD_ID)));
  router.put('/automod', (req, res) => res.json(setAutomod(GUILD_ID, req.body || {})));

  // --- role menus ---
  router.get('/role-menus', (req, res) => res.json(getAllRoleMenus(GUILD_ID)));

  router.post('/role-menus', (req, res) => {
    const { title = '', description = '', channel_id = null, buttons = [] } = req.body || {};
    const id = createRoleMenu(GUILD_ID, { title, description, channel_id: cleanId(channel_id), buttons });
    res.json(getRoleMenu(id));
  });

  router.put('/role-menus/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = getRoleMenu(id);
    if (!existing || existing.guild_id !== GUILD_ID) return res.status(404).json({ error: 'not_found' });
    const { title = '', description = '', channel_id = null, buttons = [] } = req.body || {};
    res.json(updateRoleMenu(id, GUILD_ID, { title, description, channel_id: cleanId(channel_id), buttons }));
  });

  router.delete('/role-menus/:id', (req, res) => {
    res.json({ ok: deleteRoleMenu(Number(req.params.id), GUILD_ID) > 0 });
  });

  router.post('/role-menus/:id/post', async (req, res) => {
    const id = Number(req.params.id);
    const menu = getRoleMenu(id);
    if (!menu || menu.guild_id !== GUILD_ID) return res.status(404).json({ error: 'not_found' });
    if (!menu.channel_id) return res.status(400).json({ error: 'no_channel' });
    try {
      const messageId = await postRoleMenu(client, menu);
      res.json({ ok: true, message_id: messageId });
    } catch (err) {
      console.error('Post role menu failed:', err.message);
      res.status(500).json({ error: err.message === 'invalid_channel' ? 'invalid_channel' : 'post_failed' });
    }
  });

  // --- moderation panel ---
  router.get('/modlog', (req, res) => res.json(getModLog(GUILD_ID, 100)));

  router.get('/warnings', (req, res) => {
    const guild = client.guilds.cache.get(GUILD_ID);
    const tag = (id) => guild?.members.cache.get(id)?.user?.tag || null;
    res.json(getAllWarnings(GUILD_ID).map((w) => ({
      ...w,
      user_tag: tag(w.user_id),
      moderator_tag: tag(w.moderator_id),
    })));
  });

  router.delete('/warnings/:id', (req, res) => {
    res.json({ ok: deleteWarningById(GUILD_ID, Number(req.params.id)) > 0 });
  });

  router.post('/warnings/clear', (req, res) => {
    const userId = cleanId(req.body?.user_id);
    if (!userId) return res.status(400).json({ error: 'missing_user' });
    res.json({ cleared: clearWarnings(GUILD_ID, userId) });
  });

  return router;
}
