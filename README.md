# DCS Community Bot

A Mee6-style Discord bot for a single community server. Built with **discord.js v14** and
**Node's built-in SQLite** (`node:sqlite`) — no native modules to compile.

## Features

**Moderation**
- `/ban` `/kick` `/timeout` (with "remove timeout") `/purge` — with permission gating and role-hierarchy safety checks
- `/warn` `/warnings` `/clearwarnings` — warnings are stored and persist

**Welcome / auto-role**
- Welcome & goodbye messages with placeholders: `{user}`, `{username}`, `{server}`, `{membercount}`
- Auto-assign a role to new members
- Configured with `/config welcome|goodbye|autorole|disable|show`

**Custom commands (Mee6-style)**
- `/addcommand` `/removecommand` `/commands` — create text commands triggered by a prefix (default `!`), e.g. `!rules`

**Utility**
- `/ping` `/userinfo` `/serverinfo` `/poll` `/help`

## Requirements

- **Node.js 23.4 or newer** (uses the built-in `node:sqlite`; no flag needed on 23.4+). `.nvmrc` pins `24`.

## 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy the token (this is `DISCORD_TOKEN`).
3. **Bot** tab → **Privileged Gateway Intents** → enable both:
   - **Server Members Intent** (welcome / auto-role)
   - **Message Content Intent** (the `!` custom-command triggers)
4. **General Information** tab → copy the **Application ID** (this is `DISCORD_CLIENT_ID`).

### Invite the bot

Use the **OAuth2 → URL Generator**: select scopes `bot` and `applications.commands`, then check
*Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Roles, View Channels,
Send Messages, Embed Links, Read Message History*.

Or use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1099780156422&scope=bot%20applications.commands
```

> For **auto-role** to work, drag the bot's role **above** the role it assigns
> (Server Settings → Roles).

## 2. Run locally

```bash
cp .env.example .env      # then fill in the values
npm install
npm start
```

On startup the bot auto-syncs its slash commands to the server in `DISCORD_GUILD_ID`
(instant). If you leave `DISCORD_GUILD_ID` blank, register globally instead with:

```bash
npm run deploy            # global registration; can take up to ~1h to appear
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token |
| `DISCORD_CLIENT_ID` | for `npm run deploy` | Application ID |
| `DISCORD_GUILD_ID` | recommended | Your server ID — enables instant command sync on startup |
| `COMMAND_PREFIX` | no | Prefix for custom commands (default `!`) |
| `DB_PATH` | no | SQLite file path (default `./data/bot.db`) |

## 3. Deploy on Railway

The bot is a worker (no web port) — the `Procfile` declares `worker: node ... src/index.js`.

1. Push this folder to a GitHub repo and create a Railway service from it.
2. **Variables** tab: set `DISCORD_TOKEN`, `DISCORD_GUILD_ID` (and `COMMAND_PREFIX` if not `!`).
3. **Important — persistence:** Railway's container filesystem is wiped on every redeploy.
   Add a **Volume** and mount it (e.g. at `/data`), then set `DB_PATH=/data/bot.db` so warnings,
   custom commands, and config survive restarts.
4. Deploy. Commands sync to your guild automatically on boot.

> You only need `npm run deploy` for *global* registration. With `DISCORD_GUILD_ID` set,
> the bot keeps its guild commands in sync on every startup.

## Project layout

```
src/
  index.js              # client, intents, command/event auto-loaders, login
  deploy-commands.js    # optional: register commands globally (or to a guild)
  db/index.js           # node:sqlite schema + data-access helpers
  util/format.js        # welcome/goodbye placeholder substitution
  commands/
    moderation/         # ban, kick, timeout, warn, warnings, clearwarnings, purge
    config/             # config (welcome/goodbye/autorole/disable/show)
    custom/             # addcommand, removecommand, commands
    utility/            # ping, userinfo, serverinfo, poll, help
  events/               # ready, interactionCreate, guildMemberAdd/Remove, messageCreate
```

Adding a command: drop a file in `src/commands/**` exporting `{ data, execute }`. It's loaded
automatically and synced on next startup.
