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

**Web dashboard**
- Runs in the same process as the bot (one Railway service), sharing the SQLite database.
- Discord OAuth2 login; only users with **Manage Server** can edit.
- Configure welcome/goodbye/auto-role and custom commands, with a visual **embed builder + live preview**.
- See [Web dashboard setup](#web-dashboard-setup) below.

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
| `DISCORD_CLIENT_SECRET` | for dashboard | OAuth2 Client Secret (Developer Portal → OAuth2) |
| `SESSION_SECRET` | for dashboard | Long random string used to sign session cookies |
| `BASE_URL` | for dashboard | Public dashboard URL; redirect is `BASE_URL/auth/callback` |
| `PORT` | no | Port the dashboard listens on (Railway sets this; 3000 locally) |

## Web dashboard setup

The dashboard (React + Vite) is served by the same Node process as the bot and shares its database.

1. **OAuth2 credentials** — Developer Portal → your app → **OAuth2**:
   - Copy the **Client Secret** → `DISCORD_CLIENT_SECRET` (and ensure `DISCORD_CLIENT_ID` is set).
   - Under **Redirects**, add the EXACT callback URL: `BASE_URL/auth/callback`
     (e.g. `http://localhost:3000/auth/callback` locally, `https://<railway-domain>/auth/callback` in prod).
2. **Session secret** — generate one:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` → `SESSION_SECRET`.
3. **Build the dashboard** and run:
   ```bash
   npm run build     # installs + builds dashboard/ into dashboard/dist
   npm start         # bot + dashboard on http://localhost:3000
   ```
   For frontend development with hot reload, run `npm start` in one terminal and
   `npm run dashboard` in another (Vite dev server on :5173 proxies API calls to :3000).

## 3. Deploy on Railway

This is now a **web** service (the `Procfile` declares `web: node ... src/index.js`) so it gets a public URL.

1. Push to GitHub; Railway auto-builds (`npm run build` compiles the dashboard, then `npm start`).
2. **Settings → Networking → Generate Domain** to get the public URL.
3. **Variables** tab: set `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CLIENT_ID`,
   `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, and `BASE_URL` = the generated domain (https).
4. In the Developer Portal, add `BASE_URL/auth/callback` to OAuth2 **Redirects**.
5. **Persistence:** attach a **Volume** mounted at `/data` and set `DB_PATH=/data/bot.db`.
6. Deploy. Slash commands sync on boot; open the domain to use the dashboard.

> With `DISCORD_GUILD_ID` set, guild slash commands re-sync on every startup.
> `npm run deploy` is only needed for *global* command registration.

## Project layout

```
src/
  index.js              # bot client + web server bootstrap
  deploy-commands.js    # optional: register commands globally (or to a guild)
  db/index.js           # node:sqlite schema, migrations + data-access helpers
  util/                 # format.js (placeholders), embed.js (embed JSON -> builder)
  commands/             # moderation, config, custom, utility slash commands
  events/               # ready, interactionCreate, guildMemberAdd/Remove, messageCreate
  web/
    server.js           # express app: sessions, routers, static SPA
    auth.js             # discord OAuth2 login + requireAuth
    api.js              # REST API (config, commands, guild, announce)
    oauth.js            # discord OAuth2 helpers
    sessionStore.js     # node:sqlite-backed express-session store
dashboard/              # React + Vite dashboard (built to dashboard/dist)
  src/pages/            # Welcome, Commands, Login
  src/components/       # EmbedBuilder, EmbedPreview
```

Adding a feature follows one pattern: a DB table/columns, an API route in `src/web/api.js`,
and a dashboard page under `dashboard/src/pages/`.
