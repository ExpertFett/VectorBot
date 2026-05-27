import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';
import EmptyState from '../components/EmptyState.jsx';

const fmt = (ts) => new Date(ts).toLocaleString();

export default function Traps() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => { api.getTraps().then(setData).catch((e) => setStatus(e.message)); }, []);
  if (!data) return <div className="muted page">{status || 'Loading…'}</div>;

  return (
    <div className="page">
      <PageHeader title="Carrier Traps" sub="LSO trap grades and the carrier leaderboard, captured live from your DCS server.">
        <span className="status">{status}</span>
      </PageHeader>

      <Callout type="tip">Traps are scored automatically from <b>LSO grades</b> when the mission-event hook is running. Set it up on the <b>DCS Server</b> tab.</Callout>

      <section className="card">
        <h2>Leaderboard</h2>
        {data.leaderboard.length === 0 ? <EmptyState icon="⚓">No traps logged yet — they’ll appear here once pilots start landing.</EmptyState> : (
          <table className="modlog">
            <thead><tr><th>#</th><th>Pilot</th><th>Avg</th><th>Traps</th><th>Best</th></tr></thead>
            <tbody>
              {data.leaderboard.map((r, i) => (
                <tr key={r.pilot}>
                  <td>{i + 1}</td><td>{r.pilot}</td>
                  <td><span className="tag">{r.avg_points}</span></td>
                  <td>{r.traps}</td><td>{r.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Recent traps</h2>
        {data.recent.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="cmd-list">{data.recent.map((t) => (
            <li key={t.id}>
              <span style={{ flex: 1 }}><b>{t.pilot}</b> <span className="muted">· {t.grade} ({t.points}){t.ship ? ` · ${t.ship}` : ''}</span></span>
              <span className="muted nowrap">{fmt(t.created_at)}</span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
