const DISCORD_API = 'https://discord.com/api/v10';

// Discord permission bits
const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

export function getBaseUrl() {
  let base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).trim().replace(/\/+$/, '');
  // Tolerate BASE_URL set without a scheme (e.g. "myapp.up.railway.app").
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base;
}

export function getRedirectUri() {
  return `${getBaseUrl()}/auth/callback`;
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${params}`;
}

export async function exchangeCode(code) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function discordGet(path, accessToken) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export const fetchUser = (token) => discordGet('/users/@me', token);
export const fetchUserGuilds = (token) => discordGet('/users/@me/guilds', token);

// Does this OAuth guild object grant the user Manage Server (or Admin/owner)?
export function canManageGuild(guild) {
  if (!guild) return false;
  if (guild.owner) return true;
  try {
    const perms = BigInt(guild.permissions ?? 0);
    return (perms & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;
  } catch {
    return false;
  }
}
