// Cross-app integration endpoints. Public, bearer-token-authed (NOT session-gated).
// Mounted at /integrations alongside /api (session) and /ingest (DCS hook token).
//
// ReadyRoom → Ops Bot:
//   POST   /readyroom/publish-event             create embed
//   PATCH  /readyroom/publish-event/:messageId  edit embed
//   DELETE /readyroom/publish-event/:messageId  delete embed

import { Router } from 'express';
import { getConfig, getGuildByReadyroomOutboundToken } from '../db/index.js';

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

// Resolves bearer → guildId → events channel; returns the channel object
// (or sends an error response and returns null).
async function resolveChannel(req, res, client) {
  const token = authToken(req);
  if (!token) { res.status(401).json({ error: 'missing_bearer' }); return null; }
  const guildId = getGuildByReadyroomOutboundToken(token);
  if (!guildId) { res.status(401).json({ error: 'bad_token' }); return null; }
  const cfg = getConfig(guildId);
  if (!cfg.readyroom_events_channel_id) {
    res.status(409).json({ error: 'no_events_channel_configured' });
    return null;
  }
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

  // CREATE — drop a new embed in the configured events channel.
  router.post('/readyroom/publish-event', async (req, res) => {
    const channel = await resolveChannel(req, res, client);
    if (!channel) return;
    const embed = buildEmbed(req.body || {});
    if (!embed) return res.status(400).json({ error: 'missing_title' });
    try {
      const msg = await channel.send({ embeds: [embed] });
      res.json({ ok: true, message_id: msg.id, channel_id: channel.id });
    } catch (err) {
      console.error('[integrations] publish failed:', err.message);
      res.status(500).json({ error: 'discord_send_failed' });
    }
  });

  // EDIT — update an existing embed.
  router.patch('/readyroom/publish-event/:messageId', async (req, res) => {
    const channel = await resolveChannel(req, res, client);
    if (!channel) return;
    const embed = buildEmbed(req.body || {});
    if (!embed) return res.status(400).json({ error: 'missing_title' });
    try {
      const msg = await channel.messages.fetch(String(req.params.messageId)).catch(() => null);
      if (!msg) return res.status(404).json({ error: 'message_not_found' });
      await msg.edit({ embeds: [embed] });
      res.json({ ok: true, message_id: msg.id, channel_id: channel.id });
    } catch (err) {
      console.error('[integrations] edit failed:', err.message);
      res.status(500).json({ error: 'discord_edit_failed' });
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
