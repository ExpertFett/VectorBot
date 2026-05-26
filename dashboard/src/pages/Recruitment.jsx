import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';

const fmt = (ts) => new Date(ts).toLocaleString();

export default function Recruitment() {
  const [cfg, setCfg] = useState(null);
  const [guild, setGuild] = useState(null);
  const [apps, setApps] = useState([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([api.getRecruitment(), api.guild(), api.getApplications()])
      .then(([c, g, a]) => { setCfg(c); setGuild(g); setApps(a); })
      .catch((e) => setStatus(e.message));
  }, []);
  if (!cfg || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const set = (patch) => setCfg({ ...cfg, ...patch });
  const setQ = (i, patch) => set({ questions: cfg.questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)) });
  const addQ = () => set({ questions: [...(cfg.questions || []), { label: '', required: true, paragraph: false }] });
  const removeQ = (i) => set({ questions: cfg.questions.filter((_, idx) => idx !== i) });

  const save = async () => {
    setStatus('Saving…');
    try { setCfg(await api.saveRecruitment(cfg)); setStatus('Saved ✓'); }
    catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const post = async () => {
    setStatus('Posting…');
    try { await api.saveRecruitment(cfg); await api.postRecruitment(); setStatus('Posted ✓'); }
    catch (e) { setStatus('Post failed: ' + (e.body?.error || e.message)); }
  };

  return (
    <div className="page">
      <header className="page-head"><h1>Recruitment</h1>
        <div className="actions"><span className="status">{status}</span><button className="btn" onClick={save}>Save</button></div>
      </header>

      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <b>Accept applications</b></label>
        <div className="row2">
          <label>Panel channel
            <select value={cfg.panel_channel_id || ''} onChange={(e) => set({ panel_channel_id: e.target.value || null })}>
              <option value="">— choose —</option>{guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <label>Review channel <span className="hint">staff-only</span>
            <select value={cfg.review_channel_id || ''} onChange={(e) => set({ review_channel_id: e.target.value || null })}>
              <option value="">— choose —</option>{guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
        </div>
        <label>Role granted on approval
          <select value={cfg.approve_role_id || ''} onChange={(e) => set({ approve_role_id: e.target.value || null })}>
            <option value="">— none —</option>{guild.roles.map((r) => <option key={r.id} value={r.id} disabled={!r.assignable}>{r.name}{r.assignable ? '' : ' (above bot)'}</option>)}
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

        <div className="fields-head">
          <span>Questions ({(cfg.questions || []).length}/5)</span>
          {(cfg.questions || []).length < 5 && <button className="link" onClick={addQ}>+ Add question</button>}
        </div>
        {(cfg.questions || []).map((q, i) => (
          <div className="event-role-row" key={i}>
            <input placeholder="Question" value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} />
            <label className="checkbox inline"><input type="checkbox" checked={q.required !== false} onChange={(e) => setQ(i, { required: e.target.checked })} /> required</label>
            <label className="checkbox inline"><input type="checkbox" checked={!!q.paragraph} onChange={(e) => setQ(i, { paragraph: e.target.checked })} /> long</label>
            <button className="link danger" onClick={() => removeQ(i)}>✕</button>
          </div>
        ))}
        <p className="muted">Discord modals allow up to 5 questions. Approve/Deny buttons in the review channel DM the applicant and grant the role.</p>
        <div className="actions"><button className="btn" onClick={post}>Save &amp; Post panel</button></div>
      </section>

      <section className="card">
        <h2>Recent applications ({apps.length})</h2>
        {apps.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="cmd-list">{apps.map((a) => (
            <li key={a.id}>
              <span style={{ flex: 1 }}><b>{a.user_tag || a.user_id}</b> <span className="muted">· {fmt(a.created_at)}</span></span>
              <span className="tag">{a.status}</span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
