// Cross-app integration endpoints. Public, bearer-token-authed (NOT session-gated).
// Mounted at /integrations alongside /api (session) and /ingest (DCS hook token).
//
// ReadyRoom → Ops Bot:
//   POST   /readyroom/publish-event             create embed
//   PATCH  /readyroom/publish-event/:messageId  edit embed
//   DELETE /readyroom/publish-event/:messageId  delete embed

import { Router } from 'express';
import { getConfig, setConfigValue, setReadyroomEventCallback, getGuildByReadyroomOutboundToken, setCalendarSource, setCalendarChannel } from '../db/index.js';
import { buildReadyroomPanel } from '../features/readyroomPanel.js';
import { regenerateCalendar, isValidTz } from '../features/calendar.js';

// ReadyRoom sends its wing ingest URL with each publish so two-way sign-up sync
// works without a separate manual setup. We (1) store it PER EVENT — the
// authoritative callback for that event's wing, so one guild can host events
// from multiple wings — and (2) seed the guild-wide ingest URL the first time
// as a fallback (don't clobber an admin-set value that may point elsewhere).
function autoWireIngest(guildId, body) {
  if (!guildId || !body?.signup_callback_url) return;
  try {
    if (body.readyroom_event_id) {
      setReadyroomEventCallback(guildId, body.readyroom_event_id, body.signup_callback_url);
    }
    const cfg = getConfig(guildId);
    if (!cfg?.readyroom_ingest_url) {
      setConfigValue(guildId, 'readyroom_ingest_url', String(body.signup_callback_url));
      console.log(`[integrations] auto-wired ReadyRoom ingest URL for guild ${guildId}`);
    }
  } catch (e) { console.warn('[integrations] autoWireIngest failed:', e.message); }
}

// Build the message payload for a publish/edit body. Events that carry flight
// `roles` render as the full interactive sign-up panel (flights, tasking,
// buttons); plain events fall back to the simple informational embed.
function buildMessagePayload(b) {
  if (!String(b.title || '').trim()) return null;
  if (Array.isArray(b.roles) && b.roles.length) return buildReadyroomPanel(b);
  return { embeds: [buildEmbed(b)] };
}

const READYROOM_BLUE = 0x4c8bf5;
const EXTRA_CREDIT_GOLD = 0xf0b429;
const MISSION_PURPLE = 0x8a63ff;

function colorFor(kind) {
  if (kind === 'extra_credit') return EXTRA_CREDIT_GOLD;
  if (kind === 'mission') return MISSION_PURPLE;
  return READYROOM_BLUE;
}

function authToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function fmtWhen(startMs) {
  if (!Number.isFinite(startMs)) return null;
  const secs = Math.floor(startMs / 1000);
  // Discord timestamp markdown: "Tue, May 28 8:00 PM" + "in 2 days"
  return `<t:${secs}:F> · <t:${secs}:R>`;
}

// Build the embed payload from a /publish-event body. Used by both create and edit.
function buildEmbed(b) {
  const title = String(b.title || '').slice(0, 256);
  if (!title) return null;
  const fields = [];
  const whenText = fmtWhen(Number(b.start_at) || null);
  if (whenText) fields.push({ name: 'When', value: whenText, inline: false });
  if (b.duration_min) fields.push({ name: 'Duration', value: `${b.duration_min} min`, inline: true });
  if (b.primary_aircraft) fields.push({ name: 'Aircraft', value: String(b.primary_aircraft).slice(0, 60), inline: true });
  if (b.squadron_tag) fields.push({ name: 'Squadron', value: String(b.squadron_tag).slice(0, 60), inline: true });
  return {
    title: (b.kind === 'extra_credit' ? '⭐ ' : '') + title,
    url: b.url ? String(b.url).slice(0, 500) : undefined,
    description: b.description ? String(b.description).slice(0, 1900) : undefined,
    color: colorFor(b.kind),
    timestamp: Number.isFinite(Number(b.start_at)) ? new Date(Number(b.start_at)).toISOString() : undefined,
    fields,
    footer: { text: 'Posted from ReadyRoom · sign up on the site' },
  };
}

// Build a "upcoming events" digest embed from { title, events:[{title,start_at,
// squadron_tag,kind,url}] }. One auto-refreshed message ReadyRoom keeps current.
function buildDigestEmbed(b) {
  const events = Array.isArray(b.events) ? b.events.slice(0, 25) : [];
  const lines = events.map((e) => {
    const when = fmtWhen(Number(e.start_at)) || '';
    const tag = e.squadron_tag ? `\`${String(e.squadron_tag).slice(0, 20)}\` ` : '';
    const star = e.kind === 'extra_credit' ? '⭐ ' : '';
    return `${star}${tag}**${String(e.title || 'Event').slice(0, 120)}**\n${when}`;
  });
  return {
    title: String(b.title || '📅 Upcoming Events').slice(0, 256),
    description: (lines.length ? lines.join('\n\n') : '_No upcoming events scheduled._').slice(0, 4000),
    color: READYROOM_BLUE,
    footer: { text: 'Auto-updated from ReadyRoom' },
    timestamp: new Date().toISOString(),
  };
}

// Resolves bearer → guildId → events channel; returns the channel object
// (or sends an error response and returns null).
async function resolveChannel(req, res, mainClient) {
  const token = authToken(req);
  if (!token) { res.status(401).json({ error: 'missing_bearer' }); return null; }
  const guildId = getGuildByReadyroomOutboundToken(token);
  if (!guildId) { res.status(401).json({ error: 'bad_token' }); return null; }
  const cfg = getConfig(guildId);
  if (!cfg.readyroom_events_channel_id) {
    res.status(409).json({ error: 'no_events_channel_configured' });
    return null;
  }
  const { getBotForGuild } = await import('../customBots/index.js');
  const client = getBotForGuild(guildId, mainClient);
  const channel = client.channels.cache.get(cfg.readyroom_events_channel_id)
    || (await client.channels.fetch(cfg.readyroom_events_channel_id).catch(() => null));
  if (!channel?.isTextBased()) {
    res.status(409).json({ error: 'bad_events_channel' });
    return null;
  }
  return channel;
}

export function integrationsRouter(client) {
  const router = Router();

  // CORS for the integrations router only — these endpoints are designed to be
  // called cross-origin from ReadyRoom (or any other tool wired in later) via
  // browser fetch(). The bearer-token auth on each route means we can safely
  // allow any origin: the token is the gate, not the origin.
  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');     // cache preflight 24h
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // HEALTH — used by ReadyRoom's "Test connection" button to confirm the
  // configured base URL + outbound token reach this guild AND the events
  // channel is set + valid. Returns guild name + channel name on success.
  router.get('/readyroom/health', async (req, res) => {
    const channel = await resolveChannel(req, res, client);
    if (!channel) return;
    res.json({
      ok: true,
      guild: { id: channel.guild.id, name: channel.guild.name },
      channel: { id: channel.id, name: channel.name },
    });
  });

  // CREATE — post a new message (full sign-up panel if it carries flights).
  router.post('/readyroom/publish-event', async (req, res) => {
    const channel = await resolveChannel(req, res, client);
    if (!channel) return;
    autoWireIngest(channel.guild.id, req.body);
    const payload = buildMessagePayload(req.body || {});
    if (!payload) return res.status(400).json({ error: 'missing_title' });
    try {
      const msg = await channel.send(payload);
      res.json({ ok: true, message_id: msg.id, channel_id: channel.id });
    } catch (err) {
      console.error('[integrations] publish failed:', err.message);
      res.status(500).json({ error: 'discord_send_failed' });
    }
  });

  // EDIT — re-render an existing message (e.g. roster changed on the site).
  router.patch('/readyroom/publish-event/:messageId', async (req, res) => {
    const channel = await resolveChannel(req, res, client);
    if (!channel) return;
    autoWireIngest(channel.guild.id, req.body);
    const payload = buildMessagePayload(req.body || {});
    if (!payload) return res.status(400).json({ error: 'missing_title' });
    try {
      const msg = await channel.messages.fetch(String(req.params.messageId)).catch(() => null);
      if (!msg) return res.status(404).json({ error: 'message_not_found' });
      await msg.edit(payload);
      res.json({ ok: true, message_id: msg.id, channel_id: channel.id });
    } catch (err) {
      console.error('[integrations] edit failed:', err.message);
      res.status(500).json({ error: 'discord_edit_failed' });
    }
  });

  // DIGEST CREATE — post the auto-updating "upcoming events" digest message.
  router.post('/readyroom/digest', async (req, res) => {
    const channel = await resolveChannel(req, res, client);
    if (!channel) return;
    try {
      const msg = await channel.send({ embeds: [buildDigestEmbed(req.body || {})] });
      res.json({ ok: true, message_id: msg.id, channel_id: channel.id });
    } catch (err) {
      console.error('[integrations] digest post failed:', err.message);
      res.status(500).json({ error: 'discord_send_failed' });
    }
  });

  // DIGEST EDIT — refresh the existing digest message in place.
  router.patch('/readyroom/digest/:messageId', async (req, res) => {
    const channel = await resolveChannel(req, res, client);
    if (!channel) return;
    try {
      const msg = await channel.messages.fetch(String(req.params.messageId)).catch(() => null);
      if (!msg) return res.status(404).json({ error: 'message_not_found' });
      await msg.edit({ embeds: [buildDigestEmbed(req.body || {})] });
      res.json({ ok: true, message_id: msg.id, channel_id: channel.id });
    } catch (err) {
      console.error('[integrations] digest edit failed:', err.message);
      res.status(500).json({ error: 'discord_edit_failed' });
    }
  });

  // CALENDAR — post (or refresh) the ReadyRoom month-grid calendar IMAGE as a
  // pinned message, WITHOUT the /calendar slash command. ReadyRoom drives it:
  // it passes its /share/<token> source so we can render even if the sortie
  // ingest URL was never wired, and we default the pinned-calendar channel to
  // the already-configured events channel. Repeat calls edit the same pinned
  // message. This also bootstraps the nightly auto-refresh (calendar_source +
  // calendar_channel_id get stored).
  router.post('/readyroom/calendar', async (req, res) => {
    const channel = await resolveChannel(req, res, client); // events channel + bearer auth
    if (!channel) return;
    const guildId = channel.guild.id;
    const b = req.body || {};
    try {
      const cfg = getConfig(guildId);
      let prev = {};
      try { prev = cfg.calendar_source ? JSON.parse(cfg.calendar_source) : {}; } catch { /* ignore */ }
      setCalendarSource(guildId, {
        ...prev,
        ...(b.source_url ? { source_url: String(b.source_url) } : {}),
        ...(b.tz && isValidTz(b.tz) ? { tz: b.tz } : {}),
        ...(b.title != null ? { title: String(b.title).slice(0, 80) } : {}),
      });
      // Default the pinned-calendar channel to the events channel (only if one
      // wasn't already chosen via /calendar setup — resetting it would drop the
      // existing pinned message and re-post instead of editing).
      if (!cfg.calendar_channel_id) setCalendarChannel(guildId, channel.id);
      const r = await regenerateCalendar(channel.client, guildId, { monthOffset: Number(b.month) || 0 });
      if (!r?.ok) return res.status(409).json({ error: r?.reason || 'calendar_failed' });
      res.json({ ok: true, edited: !!r.edited, channel_id: cfg.calendar_channel_id || channel.id });
    } catch (err) {
      console.error('[integrations] calendar post failed:', err.message);
      res.status(502).json({ error: 'render_failed', message: err.message });
    }
  });

  // DELETE — remove an embed.
  router.delete('/readyroom/publish-event/:messageId', async (req, res) => {
    const channel = await resolveChannel(req, res, client);
    if (!channel) return;
    try {
      const msg = await channel.messages.fetch(String(req.params.messageId)).catch(() => null);
      if (!msg) return res.json({ ok: true, missing: true }); // already gone — treat as success
      await msg.delete();
      res.json({ ok: true });
    } catch (err) {
      console.error('[integrations] delete failed:', err.message);
      res.status(500).json({ error: 'discord_delete_failed' });
    }
  });

  return router;
}
