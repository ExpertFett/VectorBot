import 'dotenv/config';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { startWebServer } from './web/server.js';

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

async function loadEvents() {
  const eventsDir = join(__dirname, 'events');
  for (const file of collectFiles(eventsDir)) {
    const mod = await import(pathToFileURL(file).href);
    const event = mod.default ?? mod;
    if (!event?.name || !event?.execute) {
      console.warn(`Skipping event ${file}: missing "name" or "execute".`);
      continue;
    }
    if (event.once) client.once(event.name, (...args) => event.execute(...args, client));
    else client.on(event.name, (...args) => event.execute(...args, client));
  }
}

await loadCommands();
await loadEvents();

// Web dashboard runs in the same process and shares the bot client + database.
startWebServer(client);

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
