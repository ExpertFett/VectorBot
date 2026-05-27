import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const fmt = (ts) => new Date(ts).toLocaleString();

export default function Moderation() {
  const [log, setLog] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [status, setStatus] = useState('');

  const load = () =>
    Promise.all([api.getModlog(), api.getWarnings()])
      .then(([l, w]) => { setLog(l); setWarnings(w); })
      .catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);

  if (!log || !warnings) return <div className="muted page">{status || 'Loading…'}</div>;

  const delWarn = async (id) => { await api.deleteWarning(id); load(); };
  const clearUser = async (userId) => {
    if (!window.confirm('Clear ALL warnings for this user?')) return;
    await api.clearWarnings(userId);
    load();
  };

  const byUser = {};
  for (const w of warnings) (byUser[w.user_id] ||= []).push(w);

  return (
    <div className="page">
      <PageHeader title="Moderation" sub="Review the moderation action log and manage member warnings.">
        <span className="status">{status}</span>
      </PageHeader>

      <section className="card">
        <h2>Warnings</h2>
        {Object.keys(byUser).length === 0 ? <p className="muted">No warnings on record.</p> : (
          Object.entries(byUser).map(([userId, ws]) => (
            <div className="warn-group" key={userId}>
              <div className="warn-head">
                <b>{ws[0].user_tag || userId}</b>
                <span className="muted"> · {ws.length} warning(s)</span>
                <button className="link danger" onClick={() => clearUser(userId)}>Clear all</button>
              </div>
              <ul className="cmd-list">
                {ws.map((w) => (
                  <li key={w.id}>
                    <span style={{ flex: 1 }}>
                      {w.reason || 'No reason'}
                      <span className="muted"> · by {w.moderator_tag || w.moderator_id} · {fmt(w.created_at)}</span>
                    </span>
                    <button className="link danger" onClick={() => delWarn(w.id)}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>Recent mod actions ({log.length})</h2>
        {log.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <table className="modlog">
            <thead><tr><th>When</th><th>Action</th><th>Target</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.id}>
                  <td className="muted nowrap">{fmt(e.created_at)}</td>
                  <td><span className="tag">{e.action}</span></td>
                  <td>{e.target_tag || e.target_id || '—'}</td>
                  <td>{e.moderator_tag || '—'}</td>
                  <td>{e.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
