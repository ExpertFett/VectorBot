import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Invites() {
  const [list, setList] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => { api.getInvites().then(setList).catch((e) => setStatus(e.message)); }, []);
  if (!list) return <div className="muted page">{status || 'Loading…'}</div>;

  return (
    <div className="page">
      <header className="page-head"><h1>Invite Tracker</h1><span className="status">{status}</span></header>
      <section className="card">
        <h2>Top inviters</h2>
        <p className="muted">Counts joins attributed to each member's invites since tracking began. Needs the bot to have <b>Manage Server</b>.</p>
        {list.length === 0 ? <p className="muted">No invites tracked yet.</p> : (
          <ul className="cmd-list">{list.map((r, i) => (
            <li key={r.inviter_id}>
              <span style={{ flex: 1 }}><b>#{i + 1}</b> {r.tag || <code>{r.inviter_id}</code>}</span>
              <span className="tag">{r.count} invite{r.count === 1 ? '' : 's'}</span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
