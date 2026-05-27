import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function Onboarding() {
  const [cfg, setCfg] = useState(null);
  const [guild, setGuild] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([api.getOnboarding(), api.guild()])
      .then(([c, g]) => { setCfg(c); setGuild(g); })
      .catch((e) => setStatus(e.message));
  }, []);
  if (!cfg || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const set = (patch) => setCfg({ ...cfg, ...patch });
  const steps = cfg.steps || [];
  const setStep = (i, patch) => set({ steps: steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const addStep = () => set({ steps: [...steps, { title: '', description: '', image: '', roles: [] }] });
  const removeStep = (i) => set({ steps: steps.filter((_, idx) => idx !== i) });
  const moveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ steps: next });
  };

  const setRole = (si, ri, patch) =>
    setStep(si, { roles: (steps[si].roles || []).map((r, idx) => (idx === ri ? { ...r, ...patch } : r)) });
  const addRole = (si) => setStep(si, { roles: [...(steps[si].roles || []), { role_id: '', label: '', emoji: '' }] });
  const removeRole = (si, ri) => setStep(si, { roles: (steps[si].roles || []).filter((_, idx) => idx !== ri) });

  const save = async () => {
    setStatus('Saving…');
    try { setCfg(await api.saveOnboarding(cfg)); setStatus('Saved ✓'); }
    catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const post = async () => {
    setStatus('Posting…');
    try { await api.saveOnboarding(cfg); await api.postOnboarding(); setStatus('Posted ✓'); }
    catch (e) { setStatus('Post failed: ' + (e.body?.error || e.message)); }
  };

  return (
    <div className="page">
      <PageHeader title="Onboarding" sub="A guided welcome tour that walks new members through roles and rules, step by step.">
        <span className="status">{status}</span><button className="btn" onClick={save}>Save</button>
      </PageHeader>

      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <b>Enable the welcome tour</b></label>
        <p className="muted">Posts a panel with a “Get Started” button. New members click it for a private, step-by-step walkthrough — pick roles, read essentials, then finish (optionally granting a member role).</p>

        <div className="row2">
          <label>Panel channel
            <select value={cfg.panel_channel_id || ''} onChange={(e) => set({ panel_channel_id: e.target.value || null })}>
              <option value="">— choose —</option>{guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <label>Role granted on finish <span className="hint">optional</span>
            <select value={cfg.completion_role_id || ''} onChange={(e) => set({ completion_role_id: e.target.value || null })}>
              <option value="">— none —</option>{guild.roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.assignable ? '' : ' ⚠ above bot'}</option>)}
            </select>
          </label>
        </div>
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

        <label>Finish message <span className="hint">shown after the last step</span>
          <textarea rows={2} value={cfg.finish_message || ''} onChange={(e) => set({ finish_message: e.target.value })} />
        </label>
      </section>

      <section className="card">
        <div className="fields-head">
          <span>Walkthrough steps ({steps.length})</span>
          <button className="link" onClick={addStep}>+ Add step</button>
        </div>

        {steps.length === 0 && <p className="muted">No steps yet — add one to build the tour.</p>}

        {steps.map((s, i) => (
          <div className="card nested" key={i}>
            <div className="fields-head">
              <span><b>Step {i + 1}</b></span>
              <span className="actions">
                <button className="link" onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</button>
                <button className="link" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>↓</button>
                <button className="link danger" onClick={() => removeStep(i)}>Remove</button>
              </span>
            </div>
            <label>Title<input value={s.title || ''} onChange={(e) => setStep(i, { title: e.target.value })} /></label>
            <label>Description<textarea rows={3} value={s.description || ''} onChange={(e) => setStep(i, { description: e.target.value })} /></label>
            <label>Image URL <span className="hint">optional</span><input placeholder="https://…" value={s.image || ''} onChange={(e) => setStep(i, { image: e.target.value })} /></label>

            <div className="fields-head">
              <span>Role buttons on this step ({(s.roles || []).length})</span>
              <button className="link" onClick={() => addRole(i)}>+ Add role</button>
            </div>
            {(s.roles || []).map((r, ri) => (
              <div className="event-role-row" key={ri}>
                <select value={r.role_id || ''} onChange={(e) => setRole(i, ri, { role_id: e.target.value })}>
                  <option value="">— role —</option>{guild.roles.map((g) => <option key={g.id} value={g.id}>{g.name}{g.assignable ? '' : ' ⚠ above bot'}</option>)}
                </select>
                <input placeholder="Button label" value={r.label || ''} onChange={(e) => setRole(i, ri, { label: e.target.value })} />
                <input className="emoji-in" placeholder="😀" value={r.emoji || ''} onChange={(e) => setRole(i, ri, { emoji: e.target.value })} />
                <button className="link danger" onClick={() => removeRole(i, ri)}>✕</button>
              </div>
            ))}
            <p className="muted">Members toggle these roles right inside the tour. Buttons turn green ✅ once owned.</p>
          </div>
        ))}

        <div className="actions"><button className="btn" onClick={post}>Save &amp; Post panel</button></div>
      </section>
    </div>
  );
}
