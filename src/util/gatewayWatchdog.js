import { Events, Status } from 'discord.js';

// Gateway health watchdog.
//
// Symptom it fixes: "the bot is online but reminders / scheduled posts / feeds
// silently stopped." On a PaaS host like Railway, an idle WebSocket can get
// culled by the network layer and leave discord.js in a state where it never
// cleanly reconnects — the process keeps running and the scheduler keeps
// ticking, but every channel.send() fails quietly, so notifications just stop.
//
// discord.js tries to reconnect on its own, so we give it a generous grace
// window. If the connection is still unusable after that, we exit the process.
// Railway (and any restart-on-crash host) then relaunches us with a fresh
// gateway connection. This is safe here: the DB + sessions live on a volume,
// the scheduler runs a catch-up tick on ready, and event reminders fire up to
// 30 min late — so a restart drops nothing.

const GRACE_MS = 90_000;     // let discord.js self-heal for 90s before we act
const CHECK_MS = 15_000;     // how often we sample connection health

export function startGatewayWatchdog(client) {
  // Log the gateway lifecycle so a recurring disconnect is visible in the logs
  // instead of being invisible (which is why this went unnoticed for a week).
  client.on(Events.ShardDisconnect, (event, id) => {
    console.warn(`[gateway] shard ${id} DISCONNECTED (code ${event?.code ?? '?'}) — discord.js will try to reconnect.`);
  });
  client.on(Events.ShardError, (error, id) => {
    console.error(`[gateway] shard ${id} ERROR:`, error?.message || error);
  });
  client.on(Events.ShardReconnecting, (id) => {
    console.log(`[gateway] shard ${id} reconnecting…`);
  });
  client.on(Events.ShardResume, (id, replayed) => {
    console.log(`[gateway] shard ${id} RESUMED (${replayed} events replayed).`);
  });

  let unhealthySince = null;
  const timer = setInterval(() => {
    const healthy = client.isReady() && client.ws?.status === Status.Ready;
    if (healthy) {
      if (unhealthySince != null) {
        console.log(`[gateway] recovered after ${Math.round((Date.now() - unhealthySince) / 1000)}s.`);
        unhealthySince = null;
      }
      return;
    }
    if (unhealthySince == null) {
      unhealthySince = Date.now();
      console.warn(`[gateway] connection UNHEALTHY (ws status=${client.ws?.status}) — watching for ${GRACE_MS / 1000}s before restart.`);
      return;
    }
    const downFor = Date.now() - unhealthySince;
    if (downFor >= GRACE_MS) {
      console.error(`[gateway] connection dead for ${Math.round(downFor / 1000)}s — exiting so the platform restarts with a fresh gateway.`);
      // Give the log line a tick to flush, then exit non-zero to trigger a restart.
      setTimeout(() => process.exit(1), 250);
    }
  }, CHECK_MS);
  timer.unref();

  console.log('[gateway] watchdog started — restarts the process if the gateway goes zombie.');
}
