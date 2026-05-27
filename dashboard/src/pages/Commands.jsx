import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';

const BLANK = { name: '', response: '', embed: null };
const NAME_RE = /^[a-z0-9_-]{1,32}$/;

export default function Commands() {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(BLANK);
  const [status, setStatus] = useState('');

  const load = () => api.getCommands().then(setList).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);

  if (!list) return <div className="muted page">{status || 'Loading…'}</div>;

  const isExisting = list.some((c) => c.name === editing.name);

  const save = async () => {
    const name = editing.name.trim().toLowerCase();
    if (!NAME_RE.test(name)) return setStatus('Invalid name: letters, numbers, - or _ (max 32, no spaces).');
    if (!editing.response && !editing.embed) return setStatus('Add response text and/or an embed.');
    try {
      await api.saveCommand(name, { response: editing.response || null, embed: editing.embed || null });
      setStatus(`Saved !${name} ✓`);
      setEditing(BLANK);
      load();
    } catch (e) {
      setStatus('Save failed: ' + (e.body?.error || e.message));
    }
  };

  const del = async (name) => {
    if (!window.confirm(`Delete !${name}?`)) return;
    try { await api.deleteCommand(name); setStatus(`Deleted !${name}`); load(); }
    catch (e) { setStatus('Delete failed: ' + e.message); }
  };

  return (
    <div className="page">
      <PageHeader title="Custom Commands" sub="Create your own !commands that reply with text or a rich embed.">
        <span className="status">{status}</span>
      </PageHeader>

      <section className="card">
        <h2>{isExisting && editing.name ? `Edit !${editing.name}` : 'New command'}</h2>
        <label>Name <span className="hint">triggered as !name in chat</span>
          <input value={editing.name} placeholder="rules"
            onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
        </label>
        <label>Response text
          <textarea rows={2} value={editing.response} placeholder="Plain text reply (optional if using an embed)"
            onChange={(e) => setEditing({ ...editing, response: e.target.value })} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={!!editing.embed}
            onChange={(e) => setEditing({ ...editing, embed: e.target.checked ? (editing.embed || {}) : null })} />
          Include an embed
        </label>
        {editing.embed && (
          <div className="embed-area">
            <EmbedBuilder value={editing.embed} onChange={(v) => setEditing({ ...editing, embed: v })} />
            <div className="preview-col">
              <div className="preview-label">Live preview</div>
              <EmbedPreview embed={editing.embed} content={editing.response} />
            </div>
          </div>
        )}
        <div className="actions">
          <button className="btn" onClick={save}>Save command</button>
          <button className="link" onClick={() => { setEditing(BLANK); setStatus(''); }}>Clear</button>
        </div>
      </section>

      <section className="card">
        <h2>Existing ({list.length})</h2>
        {list.length === 0 ? (
          <p className="muted">No custom commands yet.</p>
        ) : (
          <ul className="cmd-list">
            {list.map((c) => (
              <li key={c.name}>
                <code>!{c.name}</code>
                <span className="cmd-preview">{c.embed ? '[embed]' : (c.response || '').slice(0, 70)}</span>
                <span className="row-actions">
                  <button className="link" onClick={() => { setEditing({ name: c.name, response: c.response || '', embed: c.embed || null }); window.scrollTo(0, 0); }}>Edit</button>
                  <button className="link danger" onClick={() => del(c.name)}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
