import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const BLANK = { channel_id: '', prize: '', winners: 1, value: 1, unit: 3600, description: '', image: '' };

export default function Giveaways() {
  const [list, setList] = useState(null);
  const [guild, setGuild] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [status, setStatus] = useState('');

  const load = () => Promise.all([api.getGiveaways(), api.guild()])
    .then(([l, g]) => { setList(l); setGuild(g); }).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!list || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const create = async () => {
    if (!form.channel_id || !form.prize) return setStatus('Channel and prize are required.');
    try {
      await api.createGiveaway({ channel_id: form.channel_id, prize: form.prize, winners: form.winners, duration_seconds: Math.max(30, (form.value || 1) * form.unit), description: form.description || null, image: form.image || null });
      setStatus('Started ✓'); setForm(BLANK); load();
    } catch (e) { setStatus('Failed: ' + (e.body?.error || e.message)); }
  };
  const end = async (id) => { await api.endGiveaway(id); load(); };
  const reroll = async (id) => { await api.rerollGiveaway(id); setStatus('Rerolled ✓'); };
  const del = async (id) => { if (!window.confirm('Delete this giveaway?')) return; await api.deleteGiveaway(id); load(); };

  return (
    <div className="page">
      <PageHeader title="Giveaways" sub="Run timed giveaways with one-click entry and automatic winner draws.">
        <span className="status">{status}</span>
      </PageHeader>
      <section className="card">
        <h2>New giveaway</h2>
        <div className="row2">
          <label>Channel
            <select value={form.channel_id} onChange={(e) => setForm({ ...form, channel_id: e.target.value })}>
              <option value="">— choose —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <label>Prize<input value={form.prize} onChange={(e) => setForm({ ...form, prize: e.target.value })} placeholder="e.g. Steam key" /></label>
        </div>
        <div className="row2">
          <label>Winners<input type="number" min="1" value={form.winners} onChange={(e) => setForm({ ...form, winners: +e.target.value })} /></label>
          <label>Duration
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="number" min="1" value={form.value} onChange={(e) => setForm({ ...form, value: +e.target.value })} />
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: +e.target.value })}>
                <option value={60}>minutes</option><option value={3600}>hours</option><option value={86400}>days</option>
              </select>
            </div>
          </label>
        </div>
        <label>Description (optional)<textarea rows={2} value={form.description} placeholder="Extra text shown above the entry details" onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label>Image URL (optional)<input value={form.image} placeholder="https://…" onChange={(e) => setForm({ ...form, image: e.target.value })} /></label>
        <div className="actions"><button className="btn" onClick={create}>Start giveaway</button></div>
      </section>
      <section className="card">
        <h2>Giveaways ({list.length})</h2>
        {list.length === 0 ? <p className="muted">None.</p> : (
          <ul className="cmd-list">{list.map((g) => (
            <li key={g.id}>
              <span style={{ flex: 1 }}><b>{g.prize}</b>
                <span className="muted"> · {g.entries} entries · {g.winners} winner(s) · {g.ended ? 'ended' : `ends ${new Date(g.ends_at).toLocaleString()}`}</span>
              </span>
              <span className="row-actions">
                {!g.ended && <button className="link" onClick={() => end(g.id)}>End now</button>}
                {g.ended && <button className="link" onClick={() => reroll(g.id)}>Reroll</button>}
                <button className="link danger" onClick={() => del(g.id)}>Delete</button>
              </span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
