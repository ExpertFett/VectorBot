import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TYPES = [
  { value: 'members', label: 'Total members', template: 'Members: {count}' },
  { value: 'humans', label: 'Humans', template: 'Humans: {count}' },
  { value: 'bots', label: 'Bots', template: 'Bots: {count}' },
  { value: 'boosts', label: 'Boosts', template: 'Boosts: {count}' },
  { value: 'roles', label: 'Roles', template: 'Roles: {count}' },
  { value: 'channels', label: 'Channels', template: 'Channels: {count}' },
];
const BLANK = { type: 'members', template: 'Members: {count}' };

export default function Stats() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [status, setStatus] = useState('');

  const load = () => api.getStats().then(setList).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!list) return <div className="muted page">{status || 'Loading…'}</div>;

  const create = async () => {
    try { await api.createStat(form); setStatus('Created ✓'); load(); }
    catch (e) { setStatus('Failed: ' + (e.body?.error || e.message)); }
  };
  const del = async (id) => { if (!window.confirm('Delete this counter (and its channel)?')) return; await api.deleteStat(id); load(); };

  return (
    <div className="page">
      <header className="page-head"><h1>Stats Channels</h1><span className="status">{status}</span></header>
      <section className="card">
        <h2>New counter channel</h2>
        <p className="muted">Creates a locked voice channel whose name shows a live count (updates every ~10 min). Use <code>{'{count}'}</code> in the template.</p>
        <div className="row2">
          <label>Stat
            <select value={form.type} onChange={(e) => {
              const t = TYPES.find((x) => x.value === e.target.value);
              setForm({ type: t.value, template: t.template });
            }}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>Channel name template<input value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} /></label>
        </div>
        <div className="actions"><button className="btn" onClick={create}>Create counter</button></div>
      </section>
      <section className="card">
        <h2>Counters ({list.length})</h2>
        {list.length === 0 ? <p className="muted">None.</p> : (
          <ul className="cmd-list">{list.map((s) => (
            <li key={s.id}>
              <span style={{ flex: 1 }}><span className="tag">{s.type}</span> <code>{s.template}</code></span>
              <button className="link danger" onClick={() => del(s.id)}>Delete</button>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
