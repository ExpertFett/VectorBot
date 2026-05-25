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
  guild: () => req('GET', '/api/guild'),
  getConfig: () => req('GET', '/api/config'),
  saveConfig: (data) => req('PUT', '/api/config', data),
  getCommands: () => req('GET', '/api/commands'),
  saveCommand: (name, data) => req('PUT', `/api/commands/${encodeURIComponent(name)}`, data),
  deleteCommand: (name) => req('DELETE', `/api/commands/${encodeURIComponent(name)}`),
  announce: (data) => req('POST', '/api/announce', data),
  logout: () => req('POST', '/auth/logout'),
};
