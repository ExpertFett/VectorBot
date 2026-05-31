import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';

const STYLES = ['Primary', 'Secondary', 'Success', 'Danger'];
const BLANK = { id: null, title: '', description: '', channel_id: '', buttons: [], type: 'buttons', max_values: 1, embed: null };

export default function RoleMenus() {
  const [menus, setMenus] = useState(null);
  const [guild, setGuild] = useState(null);
  const [editing, setEditing] = useState(BLANK);
  const [status, setStatus] = useState('');

  const load = () =>
    Promise.all([api.getRoleMenus(), api.guild()])
      .then(([m, g]) => { setMenus(m); setGuild(g); })
      .catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);

  if (!menus || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const setBtn = (i, patch) =>
    setEditing({ ...editing, buttons: editing.buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });
  const addBtn = () =>
    setEditing({ ...editing, buttons: [...editing.buttons, { role_id: '', label: '', emoji: '', style: 'Secondary' }] });
  const removeBtn = (i) => setEditing({ ...editing, buttons: editing.buttons.filter((_, idx) => idx !== i) });

  const save = async () => {
    // When a custom embed is in use, title/description live on editing.embed.
    // Otherwise they live at the top level.
    const hasText = editing.embed
      ? !!(editing.embed.title || editing.embed.description)
      : !!(editing.title || editing.description);
    if (!hasText) return setStatus('Add a title or description.');
    const payload = {
      title: editing.title,
      description: editing.description,
      channel_id: editing.channel_id || null,
      buttons: editing.buttons.filter((b) => b.role_id),
      type: editing.type || 'buttons',
      max_values: Math.max(1, Number(editing.max_values) || 1),
      embed: editing.embed || null,
    };
    try {
      const saved = editing.id ? await api.updateRoleMenu(editing.id, payload) : await api.createRoleMenu(payload);
      setEditing({ ...saved, channel_id: saved.channel_id || '' });
      setStatus('Saved ✓');
      load();
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };

  const post = async (id) => {
    setStatus('Posting…');
    try { await api.postRoleMenu(id); setStatus('Posted to Discord ✓'); load(); }
    catch (e) { setStatus('Post failed: ' + (e.body?.error || e.message)); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this menu?')) return;
    await api.deleteRoleMenu(id);
    if (editing.id === id) setEditing(BLANK);
    load();
  };

  return (
    <div className="page">
      <PageHeader title="Reaction Roles" sub="Let members self-assign roles from button or dropdown menus.">
        <span className="status">{status}</span>
      </PageHeader>

      <section className="card">
        <h2>{editing.id ? 'Edit menu' : 'New role menu'}</h2>
        <label className="checkbox"><input type="checkbox" checked={!!editing.embed} onChange={(e) => setEditing({ ...editing, embed: e.target.checked ? (editing.embed || {}) : null })} /> Use a custom embed</label>
        {editing.embed ? (
          <div className="embed-area">
            <EmbedBuilder value={editing.embed} onChange={(v) => setEditing({ ...editing, embed: v })} />
            <div className="preview-col"><div className="preview-label">Preview</div><EmbedPreview embed={editing.embed} /></div>
          </div>
        ) : (
          <>
            <label>Title<input value={editing.title} placeholder="Pick your roles"
              onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
            <label>Description<textarea rows={2} value={editing.description} placeholder="Click a button to toggle a role."
              onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
          </>
        )}
        <label>Channel
          <select value={editing.channel_id} onChange={(e) => setEditing({ ...editing, channel_id: e.target.value })}>
            <option value="">— choose —</option>
            {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <div className="row2">
          <label>Menu style
            <select value={editing.type || 'buttons'} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
              <option value="buttons">Buttons</option>
              <option value="dropdown">Dropdown</option>
            </select>
          </label>
          {editing.type === 'dropdown' && (
            <label>Max roles selectable
              <input type="number" min="1" value={editing.max_values || 1} onChange={(e) => setEditing({ ...editing, max_values: +e.target.value })} />
            </label>
          )}
        </div>

        <div className="fields-head">
          <span>Buttons ({editing.buttons.length}/25)</span>
          {editing.buttons.length < 25 && <button className="link" onClick={addBtn}>+ Add button</button>}
        </div>
        {editing.buttons.map((b, i) => (
          <div className="rolebtn-row" key={i}>
            <select value={b.role_id} onChange={(e) => setBtn(i, { role_id: e.target.value })}>
              <option value="">— role —</option>
              {guild.roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.assignable ? '' : ' ⚠ above bot'}</option>
              ))}
            </select>
            <input placeholder="Label" value={b.label} onChange={(e) => setBtn(i, { label: e.target.value })} />
            <input className="emoji-in" placeholder="🙂" value={b.emoji} onChange={(e) => setBtn(i, { emoji: e.target.value })} />
            <select value={b.style} onChange={(e) => setBtn(i, { style: e.target.value })}>
              {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="link danger" onClick={() => removeBtn(i)}>✕</button>
          </div>
        ))}

        <div className="actions">
          <button className="btn" onClick={save}>{editing.id ? 'Save' : 'Create'}</button>
          {editing.id && <button className="btn" onClick={() => post(editing.id)}>Post / Update in Discord</button>}
          {editing.id && <button className="link" onClick={() => setEditing(BLANK)}>New menu</button>}
        </div>
        <p className="muted">Save first, then <b>Post</b> to send (or re-sync) the message in the chosen channel.</p>
      </section>

      <section className="card">
        <h2>Menus ({menus.length})</h2>
        {menus.length === 0 ? <p className="muted">No menus yet.</p> : (
          <ul className="cmd-list">
            {menus.map((m) => (
              <li key={m.id}>
                <span style={{ flex: 1 }}>
                  <b>{m.title || '(untitled)'}</b>
                  <span className="muted"> · {m.buttons.length} role(s) · {m.message_id ? 'posted' : 'not posted'}</span>
                </span>
                <span className="row-actions">
                  <button className="link" onClick={() => setEditing({ ...m, channel_id: m.channel_id || '' })}>Edit</button>
                  <button className="link" onClick={() => post(m.id)}>Post</button>
                  <button className="link danger" onClick={() => del(m.id)}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
