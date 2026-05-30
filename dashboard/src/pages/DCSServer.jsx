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
          Wire this Discord server to a ReadyRoom wing. Two directions: <b>(1)</b> sortie events
          from your DCS hook fan out to ReadyRoom (logbooks fill automatically); <b>(2)</b>
          ReadyRoom can publish event embeds into a channel here.
        </p>

        <h3>Outbound (DCS sorties → ReadyRoom)</h3>
        <label>ReadyRoom ingest URL <span className="hint">from your ReadyRoom wing's <b>Reveal ingest URL</b></span>
          <input
            value={readyroomUrl}
            onChange={(e) => setReadyroomUrl(e.target.value)}
            placeholder="https://your-readyroom.up.railway.app/ingest/<token>"
            onFocus={(e) => e.target.select()}
          />
        </label>
        <div className="actions"><button className="btn" onClick={saveReadyroom}>Save</button></div>

        <h3 style={{ marginTop: 18 }}>Inbound (ReadyRoom events → this Discord)</h3>
        <p className="muted">Paste these two values into your ReadyRoom <b>Wing</b> page's "Discord publish" section.</p>
        <label>Ops Bot URL (paste in ReadyRoom)
          <input readOnly value={typeof window !== 'undefined' ? window.location.origin : ''} onFocus={(e) => e.target.select()} />
        </label>
        <label>Outbound token (paste in ReadyRoom) <span className="hint">treat like a password</span>
          <input readOnly value={showToken ? (dcs.readyroom_outbound_token || '') : '••••••••••••••••••••••••'}
                 onFocus={(e) => e.target.select()} />
        </label>
        <div className="actions">
          <button className="btn" onClick={() => setShowToken((v) => !v)}>{showToken ? 'Hide' : 'Reveal'} token</button>
          <button className="btn" onClick={copyToken}>Copy token</button>
          <button className="link danger" onClick={regenToken}>Regenerate token</button>
        </div>
        <label style={{ marginTop: 10 }}>Events channel <span className="hint">where ReadyRoom event embeds will be posted</span>
          <select value={readyroomEventsChannel} onChange={(e) => setReadyroomEventsChannel(e.target.value)}>
            <option value="">— none (publishing disabled) —</option>
            {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <div className="actions"><button className="btn" onClick={saveReadyroomChannel}>Save channel</button></div>
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
