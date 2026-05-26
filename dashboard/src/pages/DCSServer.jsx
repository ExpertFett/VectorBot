import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function DCSServer() {
  const [dcs, setDcs] = useState(null);
  const [guild, setGuild] = useState(null);
  const [statusChannel, setStatusChannel] = useState('');
  const [feedChannel, setFeedChannel] = useState('');
  const [status, setStatus] = useState('');

  const load = () => Promise.all([api.getDcs(), api.guild()])
    .then(([d, g]) => { setDcs(d); setGuild(g); setStatusChannel(d.status_channel_id || ''); setFeedChannel(d.dcs_feed_channel_id || ''); })
    .catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!dcs || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const saveChannels = async () => {
    setStatus('Saving…');
    try { await api.saveConfig({ status_channel_id: statusChannel || null, dcs_feed_channel_id: feedChannel || null }); setStatus('Saved ✓'); }
    catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const regen = async () => {
    if (!window.confirm('Regenerate the ingest token? The old URL stops working — you must update the hook.')) return;
    try { const r = await api.regenIngest(); setDcs({ ...dcs, ingest_url: r.ingest_url }); setStatus('New token generated ✓'); }
    catch (e) { setStatus('Failed: ' + e.message); }
  };
  const copy = () => { navigator.clipboard?.writeText(dcs.ingest_url); setStatus('Ingest URL copied'); };

  const s = dcs.status;
  return (
    <div className="page">
      <header className="page-head"><h1>DCS Server</h1><span className="status">{status}</span></header>

      <section className="card">
        <h2>Current status</h2>
        {!s ? <p className="muted">No data received yet. Install the hook below, then start your server.</p> : (
          <ul className="cmd-list">
            <li><span style={{ flex: 1 }}>Players</span><span className="tag">{s.players ?? 0}</span></li>
            {s.mission && <li><span style={{ flex: 1 }}>Mission</span><span className="muted">{s.mission}</span></li>}
            {s.theatre && <li><span style={{ flex: 1 }}>Theatre</span><span className="muted">{s.theatre}</span></li>}
            <li><span style={{ flex: 1 }}>Last update</span><span className="muted">{s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}</span></li>
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Channels</h2>
        <div className="row2">
          <label>Live status channel <span className="hint">auto-updating embed</span>
            <select value={statusChannel} onChange={(e) => setStatusChannel(e.target.value)}>
              <option value="">— none —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <label>Event/kill feed channel
            <select value={feedChannel} onChange={(e) => setFeedChannel(e.target.value)}>
              <option value="">— none —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="actions"><button className="btn" onClick={saveChannels}>Save</button></div>
      </section>

      <section className="card">
        <h2>Hook setup</h2>
        <p className="muted">Your server’s private ingest URL — keep it secret (anyone with it can post status to your server’s embed):</p>
        <label>Ingest URL
          <input readOnly value={dcs.ingest_url} onFocus={(e) => e.target.select()} />
        </label>
        <div className="actions">
          <button className="btn" onClick={copy}>Copy URL</button>
          <button className="link danger" onClick={regen}>Regenerate token</button>
        </div>
        <ol className="muted" style={{ lineHeight: 1.7 }}>
          <li>Download <code>dcs-hook/vectorbot.lua</code> from the VectorBot repo.</li>
          <li>Open it and paste your Ingest URL into the <code>url</code> field at the top.</li>
          <li>Drop it into <code>Saved Games\DCS\Scripts\Hooks\</code> on the server PC (use your variant’s folder, e.g. <code>DCS.openbeta</code>).</li>
          <li>Restart the DCS server. Status appears here and in your status channel within a minute.</li>
        </ol>
        <p className="muted">Requires <code>desanitize</code> of <code>os</code>/<code>io</code>/<code>lfs</code> in <code>MissionScripting.lua</code> — the same setup your BombScore hook uses.</p>
      </section>
    </div>
  );
}
