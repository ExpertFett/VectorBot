import { useEffect, useState } from 'react';
import { api } from '../api.js';

const BLANK = { youtube_channel_id: '', discord_channel_id: '', mention_role_id: '' };

export default function YouTube() {
  const [list, setList] = useState(null);
  const [guild, setGuild] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [status, setStatus] = useState('');

  const load = () => Promise.all([api.getYoutube(), api.guild()])
    .then(([l, g]) => { setList(l); setGuild(g); }).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!list || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const add = async () => {
    if (!form.youtube_channel_id || !form.discord_channel_id) return setStatus('YouTube channel ID and a Discord channel are required.');
    try {
      await api.createYoutube({ youtube_channel_id: form.youtube_channel_id.trim(), discord_channel_id: form.discord_channel_id, mention_role_id: form.mention_role_id || null });
      setStatus('Added ✓'); setForm(BLANK); load();
    } catch (e) {
      setStatus('Failed: ' + (e.body?.error === 'invalid_youtube_id' ? 'Channel ID must look like UCxxxx…' : (e.body?.error || e.message)));
    }
  };
  const del = async (id) => { await api.deleteYoutube(id); load(); };

  return (
    <div className="page">
      <header className="page-head"><h1>YouTube Notifications</h1><span className="status">{status}</span></header>
      <section className="card">
        <h2>Add a channel</h2>
        <p className="muted">Use the channel ID (starts with <code>UC…</code>). On the YouTube channel: <b>More → Share channel → Copy channel ID</b>. New uploads are checked every ~5 minutes.</p>
        <label>YouTube channel ID<input value={form.youtube_channel_id} onChange={(e) => setForm({ ...form, youtube_channel_id: e.target.value })} placeholder="UCxxxxxxxxxxxxxxxxxxxxxx" /></label>
        <div className="row2">
          <label>Post in
            <select value={form.discord_channel_id} onChange={(e) => setForm({ ...form, discord_channel_id: e.target.value })}>
              <option value="">— choose —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <label>Ping role (optional)
            <select value={form.mention_role_id} onChange={(e) => setForm({ ...form, mention_role_id: e.target.value })}>
              <option value="">— none —</option>
              {guild.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </div>
        <div className="actions"><button className="btn" onClick={add}>Add</button></div>
      </section>
      <section className="card">
        <h2>Subscriptions ({list.length})</h2>
        {list.length === 0 ? <p className="muted">None.</p> : (
          <ul className="cmd-list">{list.map((s) => {
            const ch = guild.channels.find((c) => c.id === s.discord_channel_id);
            return (
              <li key={s.id}>
                <span style={{ flex: 1 }}><code>{s.youtube_channel_id}</code> <span className="muted">→ #{ch ? ch.name : s.discord_channel_id}{s.mention_role_id ? ' · pings a role' : ''}</span></span>
                <button className="link danger" onClick={() => del(s.id)}>Delete</button>
              </li>
            );
          })}</ul>
        )}
      </section>
    </div>
  );
}
