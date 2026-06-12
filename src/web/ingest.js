import { Router } from 'express';
import { getGuildByIngestToken, setServerStatus, getConfig } from '../db/index.js';
import { renderServerStatus } from '../features/serverStatus.js';
import { handleDcsEvent } from '../features/dcsEvents.js';
import { getBotForGuild } from '../customBots/index.js';

// Public, token-authenticated endpoint for DCS server hooks (machine-to-machine).
// Mounted OUTSIDE the dashboard's session auth.
export function ingestRouter(mainClient) {
  const router = Router();

  router.post('/:token', async (req, res) => {
    const guildId = getGuildByIngestToken(req.params.token);
    if (!guildId) return res.status(401).json({ error: 'bad_token' });
    const client = getBotForGuild(guildId, mainClient);

    const b = req.body || {};

    // Mission events (kills / traps) from the injected mission hook.
    if (b.type === 'events' && Array.isArray(b.events)) {
      for (const ev of b.events.slice(0, 100)) {
        await handleDcsEvent(client, guildId, ev).catch(() => {});
      }
      return res.json({ ok: true });
    }

    if (b.type === 'event' && b.text) {
      const cfg = getConfig(guildId);
      if (cfg.dcs_feed_channel_id) {
        const ch = client.channels.cache.get(cfg.dcs_feed_channel_id);
        if (ch?.isTextBased()) ch.send(String(b.text).slice(0, 1900)).catch(() => {});
      }
      return res.json({ ok: true });
    }

    // Default: a status heartbeat.
    setServerStatus(guildId, {
      online: b.online !== false,
      players: Number(b.players) || 0,
      names: Array.isArray(b.names) ? b.names.slice(0, 64).map((n) => String(n).slice(0, 40)) : [],
      mission: b.mission ? String(b.mission).slice(0, 256) : null,
      theatre: b.theatre ? String(b.theatre).slice(0, 64) : null,
      hook_version: b.hook_version ? String(b.hook_version).slice(0, 20) : null,
      updated_at: Date.now(),
    });
    renderServerStatus(client, guildId).catch(() => {});
    res.json({ ok: true });
  });

  return router;
}
