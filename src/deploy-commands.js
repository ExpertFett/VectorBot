import 'dotenv/config';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { REST, Routes } from 'discord.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment.');
  process.exit(1);
}

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const commands = [];
for (const file of collectFiles(join(__dirname, 'commands'))) {
  const mod = await import(pathToFileURL(file).href);
  const command = mod.default ?? mod;
  if (command?.data && command?.execute) commands.push(command.data.toJSON());
}

const rest = new REST().setToken(DISCORD_TOKEN);

try {
  if (DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log(`Registered ${commands.length} command(s) to guild ${DISCORD_GUILD_ID} (instant).`);
  } else {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
    console.log(`Registered ${commands.length} global command(s) (may take up to ~1h to appear).`);
  }
} catch (err) {
  console.error('Failed to register commands:', err);
  process.exit(1);
}
