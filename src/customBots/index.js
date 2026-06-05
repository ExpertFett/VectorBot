// Multi-tenant runtime: per-guild Discord clients spawned from user-provided
// tokens. Each custom bot is a discord.js Client logged in with its OWN
// application token, so for the server that wired it up, the bot shows up as
// THEIR application (name / avatar / banner controlled in the Developer
// Portal). The main shared bot still owns guilds that didn't opt in.
//
// All business logic lives in shared handlers; the custom clients just attach
// the same event/command bindings. Outbound work (scheduled messages, event
// posts, etc.) routes through getBotForGuild() so the right client sends the
// message to the right server.

import { Client, GatewayIntentBits } from 'discord.js';
import { getAllCustomBotTokens } from '../db/index.js';
import { reportError } from '../util/report.js';

// guildId -> Client
const customBots = new Map();

// Mutable boot bundle injected once at startup. The shared command Collection
// + event modules + the main client. Lets us attach the same handlers to a
// custom client without re-importing every event file.
let bootBundle = null;

function buildClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildInvites,
    ],
  });
}

function attachEvents(client, events) {
  for (const event of events) {
    if (event.once) client.once(event.name, (...args) => event.execute(...args, client));
    else client.on(event.name, (...args) => event.execute(...args, client));
  }
}

// Boot a custom bot for a guild. Returns the connected Client.
// Throws on login failure (caller surfaces to the user as an "invalid token" error).
export async function startCustomBot(guildId, token) {
  if (!bootBundle) throw new Error('custom bot runtime not initialised');
  await stopCustomBot(guildId); // clean slate if reconfiguring

  const client = buildClient();
  client.commands = bootBundle.commands;
  attachEvents(client, bootBundle.events);

  // Race the login against a timeout so a bad token doesn't hang forever.
  let readyResolve;
  const readyPromise = new Promise((res) => { readyResolve = res; });
  client.once('ready', () => readyResolve(client));

  try {
    await client.login(token);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('ready_timeout')), 20_000));
    await Promise.race([readyPromise, timeout]);
  } catch (err) {
    try { await client.destroy(); } catch { /* ignore */ }
    throw err;
  }

  // Register slash commands to JUST this guild — instant, no global sync delay.
  try {
    const data = [...bootBundle.commands.values()].map((c) => c.data.toJSON());
    await client.application.commands.set(data, guildId);
  } catch (err) {
    console.error(`[customBot ${guildId}] command sync failed:`, err.message);
  }

  customBots.set(guildId, client);
  console.log(`[customBot] running for guild ${guildId} as ${client.user.tag}`);
  return client;
}

export async function stopCustomBot(guildId) {
  const client = customBots.get(guildId);
  if (!client) return;
  try { await client.destroy(); } catch { /* ignore */ }
  customBots.delete(guildId);
  console.log(`[customBot] stopped for guild ${guildId}`);
}

// Returns the Client that should handle outbound operations for this guild.
// Custom bot if one is configured AND connected; otherwise the main bot.
export function getBotForGuild(guildId, mainClient) {
  const custom = customBots.get(guildId);
  if (custom && custom.isReady?.()) return custom;
  return mainClient;
}

// True if ANY of our clients (main or a custom bot) is currently in this guild.
// Used by requireGuild so users who fully switched to a custom bot (kicking the
// main) can still use the dashboard.
export function isGuildReachable(guildId, mainClient) {
  if (mainClient.guilds.cache.has(guildId)) return true;
  const custom = customBots.get(guildId);
  return !!(custom && custom.guilds?.cache?.has?.(guildId));
}

// Diagnostic info for the dashboard's Customize page.
export function getCustomBotStatus(guildId) {
  const client = customBots.get(guildId);
  if (!client) return { running: false };
  return {
    running: !!client.isReady?.(),
    bot_tag: client.user?.tag || null,
    bot_id: client.user?.id || null,
    bot_avatar: client.user?.displayAvatarURL?.({ size: 128 }) || null,
  };
}

export function initCustomBotRuntime(bundle) {
  bootBundle = bundle;
}

// Boot every custom bot we have a token for. Called once after the main bot
// is ready. Failures are logged + DM'd to the owner via reportError but don't
// take down the process.
export async function loadAllCustomBots() {
  if (!bootBundle) throw new Error('custom bot runtime not initialised');
  const rows = getAllCustomBotTokens();
  for (const { guild_id, custom_bot_token } of rows) {
    try {
      await startCustomBot(guild_id, custom_bot_token);
    } catch (err) {
      console.error(`[customBot] failed to start for guild ${guild_id}:`, err.message);
      reportError(bootBundle.mainClient, `customBot:${guild_id}`, err);
    }
  }
}
