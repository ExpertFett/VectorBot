import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';

export default function Tickets() {
  const [cfg, setCfg] = useState(null);
  const [guild, setGuild] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([api.getTickets(), api.guild()])
      .then(([t, g]) => { setCfg(t); setGuild(g); })
      .catch((e) => setStatus(e.message));
  }, []);
  if (!cfg || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const set = (patch) => setCfg({ ...cfg, ...patch });
  const save = async () => {
    setStatus('Saving…');
    try { setCfg(await api.saveTickets(cfg)); setStatus('Saved ✓'); }
    catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const post = async () => {
    setStatus('Posting…');
    try { await api.saveTickets(cfg); await api.postTickets(); setStatus('Posted ✓'); }
    catch (e) { setStatus('Post failed: ' + (e.body?.error || e.message)); }
  };

  return (
    <div className="page">
      <header className="page-head"><h1>Support Tickets</h1>
        <div className="actions"><span className="status">{status}</span><button className="btn" onClick={save}>Save</button></div>
      </header>
      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <b>Enable tickets</b></label>
        <p className="muted">Posts a panel with an “Open Ticket” button that creates a private channel for the member and your support role. The bot needs the <b>Manage Channels</b> permission.</p>
        <div className="row2">
          <label>Panel channel
            <select value={cfg.panel_channel_id || ''} onChange={(e) => set({ panel_channel_id: e.target.value || null })}>
              <option value="">— choose —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <label>Ticket category
            <select value={cfg.category_id || ''} onChange={(e) => set({ category_id: e.target.value || null })}>
              <option value="">— none (top level) —</option>
              {guild.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <label>Support role (can see all tickets)
          <select value={cfg.support_role_id || ''} onChange={(e) => set({ support_role_id: e.target.value || null })}>
            <option value="">— none —</option>
            {guild.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label>Button label<input value={cfg.button_label || ''} onChange={(e) => set({ button_label: e.target.value })} /></label>

        <label className="checkbox"><input type="checkbox" checked={!!cfg.embed} onChange={(e) => set({ embed: e.target.checked ? (cfg.embed || {}) : null })} /> Use a custom panel embed</label>
        {cfg.embed ? (
          <div className="embed-area">
            <EmbedBuilder value={cfg.embed} onChange={(v) => set({ embed: v })} />
            <div className="preview-col"><div className="preview-label">Preview</div><EmbedPreview embed={cfg.embed} /></div>
          </div>
        ) : (
          <>
            <label>Panel title<input value={cfg.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
            <label>Panel description<textarea rows={2} value={cfg.description || ''} onChange={(e) => set({ description: e.target.value })} /></label>
          </>
        )}
        <label>Opening message (shown inside a new ticket)<textarea rows={2} value={cfg.open_message || ''} onChange={(e) => set({ open_message: e.target.value })} /></label>
        <div className="actions"><button className="btn" onClick={post}>Save &amp; Post panel</button></div>
      </section>
    </div>
  );
}
