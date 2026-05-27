import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';
import EmptyState from '../components/EmptyState.jsx';

const fmt = (ts) => new Date(ts).toLocaleString();

export default function Bombs() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => { api.getBombs().then(setData).catch((e) => setStatus(e.message)); }, []);
  if (!data) return <div className="muted page">{status || 'Loading…'}</div>;

  return (
    <div className="page">
      <PageHeader title="Bomb Range" sub="Bomb-on-target accuracy scores and pilot rankings from the range.">
        <span className="status">{status}</span>
      </PageHeader>

      <Callout type="tip">Place a map marker whose text starts with <code>TGT</code> — bombs and rockets landing near it are scored automatically (needs the mission-event hook from the <b>DCS Server</b> tab).</Callout>

      <section className="card">
        <h2>Accuracy leaderboard <span className="hint">lower miss distance is better</span></h2>
        {data.leaderboard.length === 0 ? <EmptyState icon="🎯">No bomb scores yet — start dropping near a TGT marker.</EmptyState> : (
          <table className="modlog">
            <thead><tr><th>#</th><th>Pilot</th><th>Avg</th><th>Best</th><th>Drops</th></tr></thead>
            <tbody>
              {data.leaderboard.map((r, i) => (
                <tr key={r.pilot}>
                  <td>{i + 1}</td><td>{r.pilot}</td>
                  <td><span className="tag">{r.avg_m} m</span></td>
                  <td>{r.best_m} m</td><td>{r.drops}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Recent drops</h2>
        {data.recent.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="cmd-list">{data.recent.map((b) => (
            <li key={b.id}>
              <span style={{ flex: 1 }}><b>{b.pilot}</b> <span className="muted">· {b.distance} m ({b.grade}){b.weapon ? ` · ${b.weapon}` : ''}</span></span>
              <span className="muted nowrap">{fmt(b.created_at)}</span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
