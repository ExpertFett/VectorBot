import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';
import EmptyState from '../components/EmptyState.jsx';

const fmtTime = (ts) => new Date(ts).toLocaleString();
const fmtDur = (s) => {
  const m = Math.round((s || 0) / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default function Sorties() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => { api.getSorties().then(setData).catch((e) => setStatus(e.message)); }, []);
  if (!data) return <div className="muted page">{status || 'Loading…'}</div>;

  return (
    <div className="page">
      <PageHeader title="Sortie Log" sub="Flight hours and sortie counts logged per pilot, straight from the server.">
        <span className="status">{status}</span>
      </PageHeader>

      <Callout type="tip">A sortie is logged automatically on <b>takeoff → landing</b> when the mission-event hook is running (see the <b>DCS Server</b> tab).</Callout>

      <section className="card">
        <h2>Flight-time leaderboard</h2>
        {data.leaderboard.length === 0 ? <EmptyState icon="✈️">No sorties logged yet — they’ll show up after the first flight.</EmptyState> : (
          <table className="modlog">
            <thead><tr><th>#</th><th>Pilot</th><th>Sorties</th><th>Airborne</th></tr></thead>
            <tbody>
              {data.leaderboard.map((r, i) => (
                <tr key={r.pilot}>
                  <td>{i + 1}</td><td>{r.pilot}</td>
                  <td>{r.sorties}</td><td><span className="tag">{fmtDur(r.total_seconds)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Recent sorties</h2>
        {data.recent.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="cmd-list">{data.recent.map((s) => (
            <li key={s.id}>
              <span style={{ flex: 1 }}><b>{s.pilot}</b> <span className="muted">· {fmtDur(s.seconds)}{s.airframe ? ` · ${s.airframe}` : ''}</span></span>
              <span className="muted nowrap">{fmtTime(s.created_at)}</span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
