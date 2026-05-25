import { Router } from 'express';
import crypto from 'node:crypto';
import { buildAuthUrl, exchangeCode, fetchUser, fetchUserGuilds, canManageGuild } from './oauth.js';

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    return res.status(500).send('OAuth not configured: set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(buildAuthUrl(state));
});

authRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect('/?error=invalid_state');
  }
  delete req.session.oauthState;

  try {
    const token = await exchangeCode(String(code));
    const [user, guilds] = await Promise.all([
      fetchUser(token.access_token),
      fetchUserGuilds(token.access_token),
    ]);

    // All guilds where this user has Manage Server / Admin / is owner.
    const manageable = guilds.filter(canManageGuild).map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
    }));

    req.session.user = {
      id: user.id,
      username: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null,
    };
    req.session.manageable = manageable;
    req.session.guildId = null;
    res.redirect(manageable.length ? '/' : '/?error=no_servers');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/?error=oauth_failed');
  }
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'unauthorized' });
}
