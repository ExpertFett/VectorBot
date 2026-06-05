import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const PLATFORMS = [
  { value: 'youtube', label: 'YouTube', hint: 'channel ID (UC…)' },
  { value: 'reddit', label: 'Reddit', hint: 'subreddit name, e.g. hoggit' },
  { value: 'rss', label: 'RSS feed', hint: 'full feed URL (covers TikTok/IG/X via an RSS bridge)' },
  { value: 'twitch', label: 'Twitch (go-live)', hint: 'channel login name' },
  { value: 'kick', label: 'Kick (go-live)', hint: 'channel slug' },
];
const BLANK = { platform: 'reddit', query: '', discord_channel_id: '', mention_role_id: '' };

export default function Social() {
  const [list, setList] = useState(null);
  const [guild, setGuild] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [status, setStatus] = useState('');

  const load = () => Promise.all([api.getSocial(), api.guild()])
    .then(([l, g]) => { setList(l); setGuild(g); }).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!list || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const platform = PLATFORMS.find((p) => p.value === form.platform);
  const add = async () => {
    if (!form.query || !form.discord_channel_id) return setStatus('Source and channel are required.');
    try {
      await api.createSocial({ platform: form.platform, query: form.query, discord_channel_id: form.discord_channel_id, mention_role_id: form.mention_role_id || null });
      setStatus('Added ✓'); setForm({ ...BLANK, platform: form.platform }); load();
    } catch (e) {
      const err = e.body?.error;
      setStatus('Failed: ' + (err === 'twitch_not_configured' ? 'Twitch needs TWITCH_CLIENT_ID/SECRET set in Railway.' : (err || e.message)));
    }
  };
  const del = async (id) => { await api.deleteSocial(id); load(); };

  return (
    <div className="page">
      <PageHeader title="Social Alerts" sub="Auto-post when you go live or upload — YouTube, Twitch, Kick, Reddit and RSS feeds.">
        <span className="status">{status}</span>
      </PageHeader>
      <section className="card">
        <h2>Sources ({list.length})</h2>
        {list.length === 0 ? <p className="muted">No social sources yet — add one below.</p> : (
          <ul className="cmd-list">{list.map((s) => {
            const ch = guild.channels.find((c) => c.id === s.discord_channel_id);
            return (
              <li key={s.id}>
                <span style={{ flex: 1 }}><span className="tag">{s.platform}</span> <code>{s.query}</code> <span className="muted">→ #{ch ? ch.name : s.discord_channel_id}</span></span>
                <button className="link danger" onClick={() => del(s.id)}>Delete</button>
              </li>
            );
          })}</ul>
        )}
      </section>
      <section className="card">
        <h2>Add a source</h2>
        <div className="row2">
          <label>Platform
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label>Source <span className="hint">{platform.hint}</span>
            <input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} placeholder={platform.hint} />
          </label>
        </div>
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
        <p className="muted">Reddit/RSS post new items; Twitch/Kick post when the channel goes live. Checked every ~5 min. (TikTok, Instagram and X have no free API — use an RSS-bridge URL with the RSS option.)</p>
      </section>
    </div>
  );
}
