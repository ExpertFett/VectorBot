import { Router } from 'express';
import crypto from 'node:crypto';
import { buildAuthUrl, exchangeCode, fetchUser, fetchUserGuilds, canManageGuild } from './oauth.js';

const GUILD_ID = process.env.DISCORD_GUILD_ID;

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
    const canManage = canManageGuild(guilds.find((g) => g.id === GUILD_ID));

    req.session.user = {
      id: user.id,
      username: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null,
      canManage,
    };
    res.redirect(canManage ? '/' : '/?error=no_access');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/?error=oauth_failed');
  }
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

export function requireAuth(req, res, next) {
  if (req.session?.user?.canManage) return next();
  res.status(401).json({ error: 'unauthorized' });
}
