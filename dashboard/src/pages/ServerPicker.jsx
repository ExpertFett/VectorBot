import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Brand from '../components/Brand.jsx';

export default function ServerPicker({ onSelected, onCancel }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => { api.guilds().then(setData).catch((e) => setStatus(e.message)); }, []);
  if (!data) return <div className="center muted">{status || 'Loading…'}</div>;

  const pick = async (g) => {
    try { await api.selectGuild(g.id); onSelected(); }
    catch (e) { setStatus(e.body?.error || e.message); }
  };

  return (
    <div className="center">
      <div className="login-card" style={{ maxWidth: 480 }}>
        <Brand variant="lg" />
        <p className="muted">Choose a server to manage.</p>
        {status && <p className="error">{status}</p>}
        <div className="server-list">
          {data.servers.length === 0 && <p className="muted">You don’t have Manage Server on any servers.</p>}
          {data.servers.map((g) => (
            <div key={g.id} className={`server-row ${g.present ? '' : 'absent'}`}>
              {g.icon ? <img src={g.icon} alt="" /> : <div className="server-fallback">{(g.name || '?')[0]}</div>}
              <span className="server-name">{g.name}</span>
              {g.present
                ? <button className="btn" onClick={() => pick(g)}>Manage</button>
                : <a className="link" href={`${data.inviteBase}&guild_id=${g.id}`} target="_blank" rel="noreferrer">Add bot</a>}
            </div>
          ))}
        </div>
        {onCancel && <button className="link" style={{ marginTop: 14 }} onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
