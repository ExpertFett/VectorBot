import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';

const BLANK = { channel_id: '', content: '', embed: null, enabled: true };

export default function Sticky() {
  const [list, setList] = useState(null);
  const [guild, setGuild] = useState(null);
  const [editing, setEditing] = useState(BLANK);
  const [status, setStatus] = useState('');

  const load = () => Promise.all([api.getStickies(), api.guild()])
    .then(([l, g]) => { setList(l); setGuild(g); }).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!list || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const save = async () => {
    if (!editing.channel_id) return setStatus('Pick a channel.');
    if (!editing.content && !editing.embed) return setStatus('Add content or an embed.');
    try {
      await api.saveSticky({ channel_id: editing.channel_id, content: editing.content || null, embed: editing.embed || null, enabled: editing.enabled });
      setStatus('Saved ✓'); setEditing(BLANK); load();
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const del = async (channelId) => { if (!window.confirm('Remove this sticky?')) return; await api.deleteSticky(channelId); load(); };

  return (
    <div className="page">
      <header className="page-head"><h1>Sticky Messages</h1><span className="status">{status}</span></header>
      <section className="card">
        <h2>Set sticky</h2>
        <p className="muted">A sticky message is re-posted to the bottom of a channel whenever someone else posts (throttled).</p>
        <label>Channel
          <select value={editing.channel_id} onChange={(e) => setEditing({ ...editing, channel_id: e.target.value })}>
            <option value="">— choose —</option>
            {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <label>Message text<textarea rows={2} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} /></label>
        <label className="checkbox"><input type="checkbox" checked={!!editing.embed} onChange={(e) => setEditing({ ...editing, embed: e.target.checked ? (editing.embed || {}) : null })} /> Include an embed</label>
        {editing.embed && (
          <div className="embed-area">
            <EmbedBuilder value={editing.embed} onChange={(v) => setEditing({ ...editing, embed: v })} />
            <div className="preview-col"><div className="preview-label">Preview</div><EmbedPreview embed={editing.embed} content={editing.content} /></div>
          </div>
        )}
        <label className="checkbox"><input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} /> Enabled</label>
        <div className="actions"><button className="btn" onClick={save}>Save sticky</button>{editing.channel_id && <button className="link" onClick={() => setEditing(BLANK)}>Clear</button>}</div>
      </section>
      <section className="card">
        <h2>Active stickies ({list.length})</h2>
        {list.length === 0 ? <p className="muted">None.</p> : (
          <ul className="cmd-list">{list.map((s) => {
            const ch = guild.channels.find((c) => c.id === s.channel_id);
            return (
              <li key={s.channel_id}>
                <span style={{ flex: 1 }}>#{ch ? ch.name : s.channel_id} <span className="muted">· {s.content ? s.content.slice(0, 40) : '[embed]'}{s.enabled ? '' : ' · disabled'}</span></span>
                <span className="row-actions">
                  <button className="link" onClick={() => setEditing({ channel_id: s.channel_id, content: s.content || '', embed: s.embed || null, enabled: !!s.enabled })}>Edit</button>
                  <button className="link danger" onClick={() => del(s.channel_id)}>Delete</button>
                </span>
              </li>
            );
          })}</ul>
        )}
      </section>
    </div>
  );
}
