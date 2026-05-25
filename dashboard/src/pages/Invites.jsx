import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Invites() {
  const [list, setList] = useState(null);
  const [guild, setGuild] = useState(null);
  const [logChannel, setLogChannel] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([api.getInvites(), api.guild(), api.getConfig()])
      .then(([l, g, c]) => { setList(l); setGuild(g); setLogChannel(c.invite_log_channel || ''); })
      .catch((e) => setStatus(e.message));
  }, []);
  if (!list || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const saveChannel = async () => {
    setStatus('Saving…');
    try { await api.saveConfig({ invite_log_channel: logChannel || null }); setStatus('Saved ✓'); }
    catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };

  return (
    <div className="page">
      <header className="page-head"><h1>Invite Tracker</h1><span className="status">{status}</span></header>

      <section className="card">
        <h2>Join-log channel</h2>
        <p className="muted">Posts “X joined — invited by Y” here on each join. Needs the bot to have <b>Manage Server</b>.</p>
        <div className="row2">
          <label>Channel
            <select value={logChannel} onChange={(e) => setLogChannel(e.target.value)}>
              <option value="">— none —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <div style={{ alignSelf: 'end', paddingBottom: 9 }}><button className="btn" onClick={saveChannel}>Save</button></div>
        </div>
      </section>

      <section className="card">
        <h2>Top inviters</h2>
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
