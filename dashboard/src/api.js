async function req(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    try { err.body = await res.json(); } catch { /* ignore */ }
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
  me: () => req('GET', '/api/me'),
  guilds: () => req('GET', '/api/guilds'),
  selectGuild: (guildId) => req('POST', '/api/select-guild', { guild_id: guildId }),
  guild: () => req('GET', '/api/guild'),
  getConfig: () => req('GET', '/api/config'),
  saveConfig: (data) => req('PUT', '/api/config', data),
  getCommands: () => req('GET', '/api/commands'),
  saveCommand: (name, data) => req('PUT', `/api/commands/${encodeURIComponent(name)}`, data),
  deleteCommand: (name) => req('DELETE', `/api/commands/${encodeURIComponent(name)}`),
  announce: (data) => req('POST', '/api/announce', data),
  getSentEmbeds: () => req('GET', '/api/embeds'),
  updateSentEmbed: (id, data) => req('PUT', `/api/embeds/${id}`, data),
  deleteSentEmbed: (id) => req('DELETE', `/api/embeds/${id}`),

  getAutomod: () => req('GET', '/api/automod'),
  saveAutomod: (data) => req('PUT', '/api/automod', data),

  getRoleMenus: () => req('GET', '/api/role-menus'),
  createRoleMenu: (data) => req('POST', '/api/role-menus', data),
  updateRoleMenu: (id, data) => req('PUT', `/api/role-menus/${id}`, data),
  deleteRoleMenu: (id) => req('DELETE', `/api/role-menus/${id}`),
  postRoleMenu: (id) => req('POST', `/api/role-menus/${id}/post`),

  getModlog: () => req('GET', '/api/modlog'),
  getWarnings: () => req('GET', '/api/warnings'),
  deleteWarning: (id) => req('DELETE', `/api/warnings/${id}`),
  clearWarnings: (userId) => req('POST', '/api/warnings/clear', { user_id: userId }),

  getVerification: () => req('GET', '/api/verification'),
  saveVerification: (data) => req('PUT', '/api/verification', data),
  postVerification: () => req('POST', '/api/verification/post'),

  getTickets: () => req('GET', '/api/tickets'),
  saveTickets: (data) => req('PUT', '/api/tickets', data),
  postTickets: () => req('POST', '/api/tickets/post'),

  getScheduled: () => req('GET', '/api/scheduled'),
  createScheduled: (data) => req('POST', '/api/scheduled', data),
  updateScheduled: (id, data) => req('PUT', `/api/scheduled/${id}`, data),
  deleteScheduled: (id) => req('DELETE', `/api/scheduled/${id}`),

  getStickies: () => req('GET', '/api/stickies'),
  saveSticky: (data) => req('PUT', '/api/stickies', data),
  deleteSticky: (channelId) => req('DELETE', `/api/stickies/${channelId}`),

  getGiveaways: () => req('GET', '/api/giveaways'),
  createGiveaway: (data) => req('POST', '/api/giveaways', data),
  endGiveaway: (id) => req('POST', `/api/giveaways/${id}/end`),
  rerollGiveaway: (id) => req('POST', `/api/giveaways/${id}/reroll`),
  deleteGiveaway: (id) => req('DELETE', `/api/giveaways/${id}`),

  getYoutube: () => req('GET', '/api/youtube'),
  createYoutube: (data) => req('POST', '/api/youtube', data),
  deleteYoutube: (id) => req('DELETE', `/api/youtube/${id}`),

  getSocial: () => req('GET', '/api/social'),
  createSocial: (data) => req('POST', '/api/social', data),
  deleteSocial: (id) => req('DELETE', `/api/social/${id}`),

  getStats: () => req('GET', '/api/stats'),
  createStat: (data) => req('POST', '/api/stats', data),
  deleteStat: (id) => req('DELETE', `/api/stats/${id}`),

  getInvites: () => req('GET', '/api/invites'),

  getPersonalizer: () => req('GET', '/api/personalizer'),
  savePersonalizer: (data) => req('PUT', '/api/personalizer', data),
  getCustomBot: () => req('GET', '/api/custom-bot'),
  saveCustomBot: (token) => req('PUT', '/api/custom-bot', { token }),
  removeCustomBot: () => req('DELETE', '/api/custom-bot'),
  setBotAvatar: (url) => req('POST', '/api/bot-avatar', { url }),
  uploadBotAvatar: async (file) => {
    const res = await fetch('/api/bot-avatar-upload', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'image/png' }, body: file,
    });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); try { e.body = await res.json(); } catch { /* */ } throw e; }
    return res.json();
  },

  getDcs: () => req('GET', '/api/dcs'),
  regenIngest: () => req('POST', '/api/dcs/regen'),
  regenReadyroomToken: () => req('POST', '/api/dcs/regen-readyroom-token'),
  getTraps: () => req('GET', '/api/traps'),
  getBombs: () => req('GET', '/api/bombs'),
  getSorties: () => req('GET', '/api/sorties'),

  getRoster: () => req('GET', '/api/roster'),
  getMembers: () => req('GET', '/api/members'),
  saveRosterEntry: (userId, data) => req('PUT', `/api/roster/${userId}`, data),
  deleteRosterEntry: (userId) => req('DELETE', `/api/roster/${userId}`),
  importRoster: (csv) => req('POST', '/api/roster/import', { csv }),

  getRecruitment: () => req('GET', '/api/recruitment'),
  saveRecruitment: (data) => req('PUT', '/api/recruitment', data),
  postRecruitment: () => req('POST', '/api/recruitment/post'),
  getApplications: () => req('GET', '/api/applications'),

  getOnboarding: () => req('GET', '/api/onboarding'),
  saveOnboarding: (data) => req('PUT', '/api/onboarding', data),
  postOnboarding: () => req('POST', '/api/onboarding/post'),

  getEvents: () => req('GET', '/api/events'),
  parseMiz: async (file) => {
    const res = await fetch('/api/events/parse-miz', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); try { e.body = await res.json(); } catch { /* */ } throw e; }
    return res.json();
  },
  createEvent: (data) => req('POST', '/api/events', data),
  updateEvent: (id, data) => req('PUT', `/api/events/${id}`, data),
  postEvent: (id) => req('POST', `/api/events/${id}/post`),
  cancelEvent: (id) => req('POST', `/api/events/${id}/cancel`),
  deleteEvent: (id) => req('DELETE', `/api/events/${id}`),

  logout: () => req('POST', '/auth/logout'),
};
