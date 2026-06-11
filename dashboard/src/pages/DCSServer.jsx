import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

export default function DCSServer() {
  const [dcs, setDcs] = useState(null);
  const [guild, setGuild] = useState(null);
  const [statusChannel, setStatusChannel] = useState('');
  const [feedChannel, setFeedChannel] = useState('');
  const [embed, setEmbed] = useState(null);
  const [readyroomUrl, setReadyroomUrl] = useState('');
  const [readyroomEventsChannel, setReadyroomEventsChannel] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState('');
  const [readyroomTestMsg, setReadyroomTestMsg] = useState('');

  const load = () => Promise.all([api.getDcs(), api.guild(), api.getConfig()])
    .then(([d, g, c]) => {
      setDcs(d); setGuild(g);
      setStatusChannel(d.status_channel_id || ''); setFeedChannel(d.dcs_feed_channel_id || '');
      setReadyroomUrl(d.readyroom_ingest_url || '');
      setReadyroomEventsChannel(d.readyroom_events_channel_id || '');
      setEmbed(c.status_embed || null);
    })
    .catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!dcs || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const saveChannels = async () => {
    setStatus('Saving…');
    try { await api.saveConfig({ status_channel_id: statusChannel || null, dcs_feed_channel_id: feedChannel || null, status_embed: embed }); setStatus('Saved ✓'); }
    catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const saveReadyroomChannel = async () => {
    setStatus('Saving…');
    try {
      await api.saveConfig({ readyroom_events_channel_id: readyroomEventsChannel || null });
      setDcs({ ...dcs, readyroom_events_channel_id: readyroomEventsChannel || null });
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const copyToken = () => { navigator.clipboard?.writeText(dcs.readyroom_outbound_token || ''); setStatus('Token copied'); };
  const regenToken = async () => {
    if (!window.confirm('Regenerate the outbound token? The old one stops working — you must update it in ReadyRoom.')) return;
    try {
      const r = await api.regenReadyroomToken();
      setDcs({ ...dcs, readyroom_outbound_token: r.readyroom_outbound_token });
      setShowToken(true); setStatus('New token generated ✓');
    } catch (e) { setStatus('Failed: ' + e.message); }
  };
  // GET the configured ingest URL — ReadyRoom returns 200 + wing info if the
  // URL+token are valid, 401 if the token's wrong, network error if unreachable.
  const testReadyroomUrl = async () => {
    const v = readyroomUrl.trim();
    if (!v) return;
    setReadyroomTestMsg('Testing…');
    try {
      const res = await fetch(v, { method: 'GET' });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) setReadyroomTestMsg(`✓ Connected to wing "${body.wing.name}"${body.wing.tag ? ` (${body.wing.tag})` : ''}`);
      else if (res.status === 401) setReadyroomTestMsg('✗ Token rejected by ReadyRoom. Re-copy the ingest URL.');
      else setReadyroomTestMsg(`✗ ${body?.error || `HTTP ${res.status}`}`);
    } catch (err) {
      setReadyroomTestMsg(`✗ Could not reach ReadyRoom (${err.message}). Check the URL.`);
    }
  };

  const saveReadyroom = async () => {
    const v = readyroomUrl.trim();
    if (v && !/^https?:\/\/.+\/ingest\/.+/.test(v)) {
      setStatus('That doesn’t look like a ReadyRoom ingest URL (should end with /ingest/<token>).');
      return;
    }
    setStatus('Saving…');
    try {
      await api.saveConfig({ readyroom_ingest_url: v || null });
      setDcs({ ...dcs, readyroom_ingest_url: v || null });
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
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
      <PageHeader title="DCS Server" sub="Connect your DCS server for live status, a kill feed, and scoreboards via a small in-game hook.">
        <span className="status">{status}</span>
      </PageHeader>

      <Callout>Everything on this page (and the Carrier Traps / Bomb Range / Sortie Log boards) is powered by a lightweight Lua hook running on your DCS server PC. No data yet? Follow <b>Hook setup</b> at the bottom.</Callout>

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
        <label className="checkbox"><input type="checkbox" checked={!!embed} onChange={(e) => setEmbed(e.target.checked ? (embed || {}) : null)} /> Use a custom embed for the status message (live fields are appended)</label>
        {embed && (
          <div className="embed-area">
            <EmbedBuilder value={embed} onChange={setEmbed} />
            <div className="preview-col"><div className="preview-label">Header preview</div><EmbedPreview embed={embed} /></div>
          </div>
        )}
        <div className="actions"><button className="btn" onClick={saveChannels}>Save</button></div>
      </section>

      <section className="card">
        <h2>ReadyRoom integration</h2>
        <p className="muted">
          Wire this Discord server to a ReadyRoom wing. Two directions, each set up independently:
        </p>
        <ul className="muted" style={{ marginTop: 0 }}>
          <li><b>Sorties → ReadyRoom</b> — your DCS hook fans sorties out to ReadyRoom so logbooks fill themselves. <i>Setup happens here.</i></li>
          <li><b>Events ← ReadyRoom</b> — ReadyRoom posts event embeds into a channel here. <i>Setup happens in ReadyRoom — these fields are values you paste over there.</i></li>
        </ul>

        <h3>① Sorties → ReadyRoom <span className="hint">paste a URL from ReadyRoom</span></h3>
        <p className="muted" style={{ marginTop: 0 }}>
          On ReadyRoom: <b>Wing page → Sortie ingest → Reveal URL</b>. Copy that URL, paste it below.
        </p>
        <label>ReadyRoom ingest URL
          <input
            value={readyroomUrl}
            onChange={(e) => setReadyroomUrl(e.target.value)}
            placeholder="https://dcsoptreadyroom.up.railway.app/ingest/<token>"
            onFocus={(e) => e.target.select()}
          />
        </label>
        <div className="actions">
          <button className="btn" onClick={saveReadyroom}>Save</button>
          <button className="btn" disabled={!readyroomUrl} onClick={testReadyroomUrl}>Test connection</button>
        </div>
        {readyroomTestMsg && <p className="muted" style={{ marginTop: 6 }}>{readyroomTestMsg}</p>}

        <h3 style={{ marginTop: 22 }}>② Events ← ReadyRoom <span className="hint">copy these values, paste them in ReadyRoom</span></h3>
        <p className="muted" style={{ marginTop: 0 }}>
          On ReadyRoom: <b>Wing page → Discord publish</b>. The Ops Bot URL field there is prefilled to this site,
          so you usually only need to paste the <b>outbound token</b> and pick a channel below.
        </p>
        <label>Ops Bot URL <span className="hint">already prefilled in ReadyRoom — shown here for self-hosters</span>
          <input readOnly value={typeof window !== 'undefined' ? window.location.origin : ''} onFocus={(e) => e.target.select()} />
        </label>
        <label>Outbound token <span className="hint">paste into ReadyRoom — treat like a password</span>
          <input readOnly value={showToken ? (dcs.readyroom_outbound_token || '') : '••••••••••••••••••••••••'}
                 onFocus={(e) => e.target.select()} />
        </label>
        <div className="actions">
          <button className="btn" onClick={() => setShowToken((v) => !v)}>{showToken ? 'Hide' : 'Reveal'} token</button>
          <button className="btn" onClick={copyToken}>Copy token</button>
          <button className="link danger" onClick={regenToken}>Regenerate token</button>
        </div>
        <label style={{ marginTop: 10 }}>Events channel <span className="hint">where ReadyRoom event embeds land</span>
          <select value={readyroomEventsChannel} onChange={(e) => setReadyroomEventsChannel(e.target.value)}>
            <option value="">— none (publishing disabled) —</option>
            {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <div className="actions"><button className="btn" onClick={saveReadyroomChannel}>Save channel</button></div>
      </section>

      <section className="card">
        <h2>Hook setup</h2>
        <p className="muted">Three files go into your DCS Saved Games <code>Scripts\Hooks</code> folder. We pre-bake your ingest URL into them — you don't have to edit anything.</p>

        <div className="actions" style={{ marginTop: 12 }}>
          <a className="btn" href="/api/dcs/installer.zip" download>📦 Download installer (.zip)</a>
        </div>

        <h3 style={{ marginTop: 18 }}>What to do with the zip:</h3>
        <ol style={{ lineHeight: 1.8 }}>
          <li>Unzip the file you just downloaded.</li>
          <li>Open File Explorer, paste this into the address bar, hit Enter:<br />
            <code style={{ background: 'var(--bg-2)', padding: '4px 8px', borderRadius: 4, fontSize: '0.9rem' }}>%USERPROFILE%\Saved Games</code></li>
          <li>Open your DCS variant's folder (<code>DCS</code>, <code>DCS.openbeta</code>, or <code>DCS.server</code>).</li>
          <li>Go into <code>Scripts\Hooks</code> (create those subfolders if they don't exist).</li>
          <li>Drop the three files from the zip in. Restart the DCS server.</li>
        </ol>

        <p className="muted" style={{ marginTop: 12 }}>
          Within ~60 seconds of restart, the "Current status" card at the top of this page should flip to your live data.
          If nothing happens after 2 minutes, check <code>Saved Games\&lt;variant&gt;\Logs\dcs.log</code> for lines starting with <code>DCSOPT:</code>.
        </p>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.9rem' }}>Advanced: your raw ingest URL + token regen</summary>
          <div style={{ marginTop: 10 }}>
            <p className="muted" style={{ fontSize: '0.85rem' }}>Anyone with this URL can post status to your server's embed — treat it like a password.</p>
            <label>Ingest URL
              <input readOnly value={dcs.ingest_url} onFocus={(e) => e.target.select()} />
            </label>
            <div className="actions">
              <button className="btn" onClick={copy}>Copy URL</button>
              <button className="link danger" onClick={regen}>Regenerate token</button>
            </div>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Regenerating invalidates the old URL — you'd have to re-download the installer and re-drop the files.
            </p>
          </div>
        </details>

        <p className="muted" style={{ marginTop: 14, fontSize: '0.85rem' }}>
          Requires <code>desanitize</code> of <code>os</code> / <code>io</code> / <code>lfs</code> in <code>MissionScripting.lua</code>.
          If you've already run other hooks (BombScore, SRS, etc.), this is already done.
        </p>
      </section>
    </div>
  );
}
