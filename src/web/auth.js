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
  // Force the session write to land in the DB before we redirect to Discord —
  // otherwise the state-cookie pair can hit the callback before the row exists.
  req.session.save((err) => {
    if (err) {
      console.error('[auth] session save (/login) failed:', err.message);
      return res.status(500).send('Could not start login. Try again.');
    }
    res.redirect(buildAuthUrl(state));
  });
});

authRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    console.warn('[auth] callback rejected: invalid_state (sid=%s, has_state=%s)',
      req.sessionID?.slice(0, 8), !!req.session.oauthState);
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
    // All Discord guilds the user is in. Used to gate non-admin access to
    // guilds where they have an Access Group permission but no Manage Server.
    req.session.userGuildIds = guilds.map((g) => g.id);
    req.session.guildId = null;
    // Cache of {guildId: [roleId, ...]} populated lazily on select-guild —
    // saves a member fetch on every API call for non-admins.
    req.session.memberRoles = {};
    // Same race: if the redirect fires before the upsert commits, the cookie
    // points at an sid that the next request will fail to look up, and the user
    // bounces straight back to /login. Force a sync save before redirecting.
    req.session.save((err) => {
      if (err) {
        console.error('[auth] session save (/callback) failed:', err.message);
        return res.redirect('/?error=session_save_failed');
      }
      console.log('[auth] login ok: user=%s sid=%s manageable=%d',
        user.username, req.sessionID?.slice(0, 8), manageable.length);
      res.redirect(manageable.length ? '/' : '/?error=no_servers');
    });
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
