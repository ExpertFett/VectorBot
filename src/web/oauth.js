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

// Fetch ALL of the user's guilds, paginating past Discord's 200-per-page cap.
// Without this, a user in 200+ servers whose managed guild sorts beyond the
// first page would look like they manage nothing — the "you don't have Manage
// Server on any servers" bug. We page with ?after=<lastId> until a short page.
export async function fetchUserGuilds(token) {
  const all = [];
  let after = null;
  for (let i = 0; i < 20; i++) {            // hard cap: 20 pages = 4000 guilds
    const q = new URLSearchParams({ limit: '200' });
    if (after) q.set('after', after);
    const page = await discordGet(`/users/@me/guilds?${q}`, token);
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 200) break;           // last page
    after = page[page.length - 1].id;       // guilds come back id-ascending
  }
  return all;
}

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
