import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';
import MentionPicker from '../components/MentionPicker.jsx';

const BLANK = { id: null, channel_id: '', content: '', embed: {}, useEmbed: true, mentions: [] };

export default function EmbedPanel() {
  const [guild, setGuild] = useState(null);
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(BLANK);
  const [status, setStatus] = useState('');
  const formRef = useRef(null);
  const scrollToForm = () => setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);

  const load = () => Promise.all([api.guild(), api.getSentEmbeds()])
    .then(([g, l]) => { setGuild(g); setList(l); }).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!guild || !list) return <div className="muted page">{status || 'Loading…'}</div>;

  const startNew = () => { setEditing(BLANK); setStatus(''); scrollToForm(); };
  const startEdit = (e) => {
    setEditing({
      id: e.id, channel_id: e.channel_id, content: e.content || '',
      embed: e.embed || {}, useEmbed: !!e.embed,
    });
    setStatus('');
    scrollToForm();
  };

  const send = async () => {
    if (!editing.useEmbed && !editing.content.trim()) return setStatus('Add message text or include an embed.');
    if (!editing.id && !editing.channel_id) return setStatus('Pick a channel.');
    setStatus(editing.id ? 'Updating…' : 'Sending…');
    try {
      if (editing.id) {
        await api.updateSentEmbed(editing.id, {
          content: editing.content || null,
          embed: editing.useEmbed ? editing.embed : null,
        });
        setStatus('Updated ✓');
      } else {
        await api.announce({
          channel_id: editing.channel_id,
          content: editing.content || null,
          embed: editing.useEmbed ? editing.embed : null,
          mentions: editing.mentions,
        });
        setStatus('Sent ✓');
        setEditing(BLANK);
      }
      load();
    } catch (e) {
      setStatus((editing.id ? 'Update failed: ' : 'Send failed: ') + (e.body?.detail || e.body?.error || e.message));
    }
  };

  const remove = async (e) => {
    if (!window.confirm('Delete this embed from Discord too? (The message will be removed from the channel.)')) return;
    try { await api.deleteSentEmbed(e.id); if (editing.id === e.id) setEditing(BLANK); load(); }
    catch (err) { setStatus('Delete failed: ' + (err.body?.error || err.message)); }
  };

  const channelOf = (id) => guild.channels.find((c) => c.id === id);
  const fmt = (ts) => new Date(ts).toLocaleString();

  return (
    <div className="page">
      <PageHeader title="Send Embed" sub="Compose and send a rich embed to any channel — and edit or delete it later from here.">
        <span className="status">{status}</span><button className="btn" onClick={send}>{editing.id ? 'Save changes' : 'Send now'}</button>
      </PageHeader>

      <section className="card">
        <div className="fields-head">
          <h2 style={{ margin: 0 }}>Sent embeds ({list.length})</h2>
          <button className="link" onClick={startNew}>+ New embed</button>
        </div>
        {list.length === 0 ? (
          <p className="muted">No embeds sent yet — fill in the form below and hit <b>Send now</b>.</p>
        ) : (
          <ul className="cmd-list">{list.map((e) => {
            const ch = channelOf(e.channel_id);
            const preview = e.content ? e.content.slice(0, 60) : (e.embed?.title || e.embed?.description?.slice(0, 60) || '[embed]');
            return (
              <li key={e.id}>
                <span style={{ flex: 1 }}>
                  <b>#{ch ? ch.name : e.channel_id}</b>
                  <span className="muted"> · {preview}{preview.length >= 60 ? '…' : ''} · {fmt(e.created_at)}</span>
                </span>
                <span className="row-actions">
                  <button className="link" onClick={() => startEdit(e)}>Edit</button>
                  <button className="link danger" onClick={() => remove(e)}>Delete</button>
                </span>
              </li>
            );
          })}</ul>
        )}
      </section>

      <section className="card" ref={formRef}>
        <h2>{editing.id ? `Edit embed #${editing.id}` : 'New embed'}</h2>
        {editing.id ? (
          <p className="muted">Editing the original Discord message in <b>#{channelOf(editing.channel_id)?.name || editing.channel_id}</b>. (Channel can’t be changed — delete and re-send to move it.)</p>
        ) : (
          <label>Channel
            <select value={editing.channel_id} onChange={(e) => setEditing({ ...editing, channel_id: e.target.value })}>
              <option value="">— choose —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
        )}
        <label>Message text<textarea rows={2} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} placeholder="Optional text above the embed" /></label>
        {!editing.id && (
          <MentionPicker value={editing.mentions} roles={guild.roles} onChange={(m) => setEditing({ ...editing, mentions: m })} label="Ping roles with this announcement" />
        )}
        <label className="checkbox"><input type="checkbox" checked={editing.useEmbed} onChange={(e) => setEditing({ ...editing, useEmbed: e.target.checked })} /> Include an embed</label>
        {editing.useEmbed && (
          <div className="embed-area">
            <EmbedBuilder value={editing.embed} onChange={(v) => setEditing({ ...editing, embed: v })} />
            <div className="preview-col"><div className="preview-label">Preview</div><EmbedPreview embed={editing.embed} content={editing.content} /></div>
          </div>
        )}
        <div className="actions">
          <button className="btn" onClick={send}>{editing.id ? 'Save changes' : 'Send now'}</button>
          {editing.id && <button className="link" onClick={startNew}>New embed</button>}
        </div>
      </section>
    </div>
  );
}
