import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';

const BLANK = { id: null, channel_id: '', content: '', embed: null, type: 'once', run_at: '', interval_value: 1, interval_unit: 3600, enabled: true };

export default function ScheduledMessages() {
  const [list, setList] = useState(null);
  const [guild, setGuild] = useState(null);
  const [editing, setEditing] = useState(BLANK);
  const [status, setStatus] = useState('');

  const load = () => Promise.all([api.getScheduled(), api.guild()])
    .then(([l, g]) => { setList(l); setGuild(g); }).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!list || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const save = async () => {
    if (!editing.channel_id) return setStatus('Pick a channel.');
    if (!editing.content && !editing.embed) return setStatus('Add content or an embed.');
    const payload = { channel_id: editing.channel_id, content: editing.content || null, embed: editing.embed || null, type: editing.type, enabled: editing.enabled };
    if (editing.type === 'interval') payload.interval_seconds = Math.max(60, (editing.interval_value || 1) * editing.interval_unit);
    else payload.run_at = editing.run_at ? new Date(editing.run_at).toISOString() : new Date().toISOString();
    try {
      if (editing.id) await api.updateScheduled(editing.id, payload); else await api.createScheduled(payload);
      setStatus('Saved ✓'); setEditing(BLANK); load();
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const edit = (s) => setEditing({
    id: s.id, channel_id: s.channel_id, content: s.content || '', embed: s.embed || null,
    type: s.type, run_at: '', interval_value: s.interval_seconds ? Math.round(s.interval_seconds / 3600) : 1, interval_unit: 3600, enabled: !!s.enabled,
  });
  const del = async (id) => { if (!window.confirm('Delete this scheduled message?')) return; await api.deleteScheduled(id); if (editing.id === id) setEditing(BLANK); load(); };

  return (
    <div className="page">
      <PageHeader title="Scheduled Messages" sub="Post a message on a timer — once at a set time, or on a repeating interval.">
        <span className="status">{status}</span>
      </PageHeader>
      <section className="card">
        <h2>{editing.id ? 'Edit' : 'New'} scheduled message</h2>
        <label>Channel
          <select value={editing.channel_id} onChange={(e) => setEditing({ ...editing, channel_id: e.target.value })}>
            <option value="">— choose —</option>
            {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <label>Message text<textarea rows={2} value={editing.content} placeholder="Plain text (optional if using an embed)" onChange={(e) => setEditing({ ...editing, content: e.target.value })} /></label>
        <label className="checkbox"><input type="checkbox" checked={!!editing.embed} onChange={(e) => setEditing({ ...editing, embed: e.target.checked ? (editing.embed || {}) : null })} /> Include an embed</label>
        {editing.embed && (
          <div className="embed-area">
            <EmbedBuilder value={editing.embed} onChange={(v) => setEditing({ ...editing, embed: v })} />
            <div className="preview-col"><div className="preview-label">Preview</div><EmbedPreview embed={editing.embed} content={editing.content} /></div>
          </div>
        )}
        <div className="row2">
          <label>Schedule
            <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
              <option value="once">Once</option>
              <option value="interval">Repeating</option>
            </select>
          </label>
          {editing.type === 'once'
            ? <label>When<input type="datetime-local" value={editing.run_at} onChange={(e) => setEditing({ ...editing, run_at: e.target.value })} /></label>
            : (
              <label>Every
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="number" min="1" value={editing.interval_value} onChange={(e) => setEditing({ ...editing, interval_value: +e.target.value })} />
                  <select value={editing.interval_unit} onChange={(e) => setEditing({ ...editing, interval_unit: +e.target.value })}>
                    <option value={60}>minutes</option><option value={3600}>hours</option><option value={86400}>days</option>
                  </select>
                </div>
              </label>
            )}
        </div>
        <label className="checkbox"><input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} /> Enabled</label>
        <div className="actions"><button className="btn" onClick={save}>{editing.id ? 'Save' : 'Create'}</button>{editing.id && <button className="link" onClick={() => setEditing(BLANK)}>New</button>}</div>
      </section>
      <section className="card">
        <h2>Scheduled ({list.length})</h2>
        {list.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="cmd-list">{list.map((s) => {
            const ch = guild.channels.find((c) => c.id === s.channel_id);
            return (
              <li key={s.id}>
                <span style={{ flex: 1 }}>{s.content ? s.content.slice(0, 45) : '[embed]'}
                  <span className="muted"> · #{ch ? ch.name : s.channel_id} · {s.type === 'interval' ? `every ${Math.round(s.interval_seconds / 60)}m` : 'once'} · next {new Date(s.next_run).toLocaleString()}{s.enabled ? '' : ' · disabled'}</span>
                </span>
                <span className="row-actions"><button className="link" onClick={() => edit(s)}>Edit</button><button className="link danger" onClick={() => del(s.id)}>Delete</button></span>
              </li>
            );
          })}</ul>
        )}
      </section>
    </div>
  );
}
