import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';

export default function Verification() {
  const [cfg, setCfg] = useState(null);
  const [guild, setGuild] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([api.getVerification(), api.guild()])
      .then(([v, g]) => { setCfg(v); setGuild(g); })
      .catch((e) => setStatus(e.message));
  }, []);
  if (!cfg || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const set = (patch) => setCfg({ ...cfg, ...patch });
  const save = async () => {
    setStatus('Saving…');
    try { setCfg(await api.saveVerification(cfg)); setStatus('Saved ✓'); }
    catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const post = async () => {
    setStatus('Posting…');
    try { await api.saveVerification(cfg); await api.postVerification(); setStatus('Posted ✓'); }
    catch (e) { setStatus('Post failed: ' + (e.body?.error || e.message)); }
  };

  return (
    <div className="page">
      <header className="page-head"><h1>Verification</h1>
        <div className="actions"><span className="status">{status}</span><button className="btn" onClick={save}>Save</button></div>
      </header>
      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <b>Enable verification gate</b></label>
        <p className="muted">Posts a message with a button; clicking it grants the chosen role. Pair with channel permissions so unverified members only see the verify channel.</p>
        <div className="row2">
          <label>Channel
            <select value={cfg.channel_id || ''} onChange={(e) => set({ channel_id: e.target.value || null })}>
              <option value="">— choose —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <label>Role granted
            <select value={cfg.role_id || ''} onChange={(e) => set({ role_id: e.target.value || null })}>
              <option value="">— choose —</option>
              {guild.roles.map((r) => <option key={r.id} value={r.id} disabled={!r.assignable}>{r.name}{r.assignable ? '' : ' (above bot)'}</option>)}
            </select>
          </label>
        </div>
        <label>Button label<input value={cfg.button_label || ''} onChange={(e) => set({ button_label: e.target.value })} /></label>

        <label className="checkbox"><input type="checkbox" checked={!!cfg.embed} onChange={(e) => set({ embed: e.target.checked ? (cfg.embed || {}) : null })} /> Use a custom embed</label>
        {cfg.embed ? (
          <div className="embed-area">
            <EmbedBuilder value={cfg.embed} onChange={(v) => set({ embed: v })} />
            <div className="preview-col"><div className="preview-label">Preview</div><EmbedPreview embed={cfg.embed} /></div>
          </div>
        ) : (
          <>
            <label>Title<input value={cfg.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
            <label>Description<textarea rows={3} value={cfg.description || ''} onChange={(e) => set({ description: e.target.value })} /></label>
          </>
        )}
        <div className="actions"><button className="btn" onClick={post}>Save &amp; Post panel</button></div>
      </section>
    </div>
  );
}
