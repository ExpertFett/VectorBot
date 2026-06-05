// DCS:OPT Ops Link Bot — main process entrypoint.
import 'dotenv/config';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { startWebServer } from './web/server.js';
import { startScheduler } from './scheduler/index.js';
import { reportError } from './util/report.js';
import { initCustomBotRuntime, loadAllCustomBots } from './customBots/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // privileged: welcome / auto-role
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,    // privileged: "!" custom-command triggers
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,      // invite tracker
  ],
});

client.commands = new Collection();

// Recursively collect every .js file under a directory.
function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

async function loadCommands() {
  const commandsDir = join(__dirname, 'commands');
  for (const file of collectFiles(commandsDir)) {
    const mod = await import(pathToFileURL(file).href);
    const command = mod.default ?? mod;
    if (command?.data && command?.execute) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`Skipping ${file}: missing "data" or "execute" export.`);
    }
  }
  console.log(`Loaded ${client.commands.size} slash command(s).`);
}

// Load every event module once and keep the list so we can also attach the
// same handlers to custom-bot clients spawned at runtime.
const eventModules = [];
async function loadEvents() {
  const eventsDir = join(__dirname, 'events');
  for (const file of collectFiles(eventsDir)) {
    const mod = await import(pathToFileURL(file).href);
    const event = mod.default ?? mod;
    if (!event?.name || !event?.execute) {
      console.warn(`Skipping event ${file}: missing "name" or "execute".`);
      continue;
    }
    eventModules.push(event);
    if (event.once) client.once(event.name, (...args) => event.execute(...args, client));
    else client.on(event.name, (...args) => event.execute(...args, client));
  }
}

await loadCommands();
await loadEvents();

// Wire up the multi-tenant runtime so each guild's custom bot (if any) shares
// the same command Collection + event modules as the main bot.
initCustomBotRuntime({ commands: client.commands, events: eventModules, mainClient: client });

// Web dashboard runs in the same process and shares the bot client + database.
startWebServer(client);

// Background scheduler for scheduled messages, reminders, giveaways, YouTube polling.
startScheduler(client);

process.on('unhandledRejection', (err) => reportError(client, 'unhandledRejection', err));

client.once('ready', () => {
  // Spawn any custom bots configured per-guild. Failures are reported but
  // don't take down the main bot.
  loadAllCustomBots().catch((e) => reportError(client, 'customBot:bootstrap', e));
});

client.login(process.env.DISCORD_TOKEN);
