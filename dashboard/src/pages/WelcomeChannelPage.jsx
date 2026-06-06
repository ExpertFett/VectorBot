import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

// Mee6-style Welcome Channel: a single channel becomes a multi-element landing
// page. Each "element" renders as its own embed. Element types:
//   - banner:  big image (optionally with a title overlay) — pair with a banner
//              image that already has its own title text rendered on it
//   - section: title + markdown description (+ optional inline image)
//   - columns: a heading row with 2–3 inline columns (heading + body each)

const ELEMENT_TYPES = [
  { id: 'banner',  label: 'Banner image',     hint: 'A wide image — use one that has the section title rendered on it (e.g. "Welcome", "Rules"). Optional fallback title.' },
  { id: 'section', label: 'Text section',     hint: 'A title and a paragraph of markdown. Optional inline image. Use this for descriptions, rules, server info.' },
  { id: 'columns', label: 'Columns (2 or 3)', hint: 'A heading + up to three side-by-side columns. Use this for link lists, socials, or a quick reference.' },
];

const blank = (type) => {
  if (type === 'banner')  return { type, title: '', image_url: '' };
  if (type === 'section') return { type, title: '', description: '', image_url: '' };
  if (type === 'columns') return { type, title: '', columns: [{ heading: '', content: '' }, { heading: '', content: '' }] };
  return { type: 'section', title: '', description: '', image_url: '' };
};

function ElementEditor({ el, onChange, onDelete, onMoveUp, onMoveDown, canUp, canDown, idx }) {
  const set = (patch) => onChange({ ...el, ...patch });
  const setCol = (i, patch) => {
    const cols = (el.columns || []).slice();
    cols[i] = { ...cols[i], ...patch };
    set({ columns: cols });
  };
  const addCol = () => set({ columns: [...(el.columns || []), { heading: '', content: '' }].slice(0, 3) });
  const dropCol = (i) => set({ columns: (el.columns || []).filter((_, k) => k !== i) });

  return (
    <div className="card welcome-element">
      <div className="welcome-element-head">
        <div>
          <span className="tag" style={{ background: 'var(--accent)', color: '#fff', textTransform: 'uppercase', fontSize: '0.7rem' }}>{el.type}</span>
          <b style={{ marginLeft: 8 }}>#{idx + 1}</b>
        </div>
        <div className="actions" style={{ margin: 0 }}>
          <button className="link" onClick={onMoveUp} disabled={!canUp} title="Move up">↑</button>
          <button className="link" onClick={onMoveDown} disabled={!canDown} title="Move down">↓</button>
          <button className="link danger" onClick={onDelete} title="Delete element">Delete</button>
        </div>
      </div>

      {el.type === 'banner' && (
        <>
          <label>Banner image URL
            <input type="url" placeholder="https://i.imgur.com/your-banner.png" value={el.image_url || ''} onChange={(e) => set({ image_url: e.target.value })} />
          </label>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Tip: pick a wide image (1100×400ish) with the section title already rendered on it for the Mee6-style look. Upload to Imgur/Postimage and paste the direct link.
          </p>
          <label>Fallback title <span className="hint">(only shown if Discord can’t load the image)</span>
            <input maxLength={256} placeholder="Welcome" value={el.title || ''} onChange={(e) => set({ title: e.target.value })} />
          </label>
        </>
      )}

      {el.type === 'section' && (
        <>
          <label>Title<input maxLength={256} placeholder="About this server" value={el.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
          <label>Body (markdown)
            <textarea rows={6} maxLength={4000} placeholder="Write a paragraph or two about your server, rules, or whatever fits this section."
              value={el.description || ''} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <label>Inline image URL (optional)
            <input type="url" placeholder="https://…" value={el.image_url || ''} onChange={(e) => set({ image_url: e.target.value })} />
          </label>
        </>
      )}

      {el.type === 'columns' && (
        <>
          <label>Heading<input maxLength={256} placeholder="Links" value={el.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
          <div className="welcome-columns">
            {(el.columns || []).map((c, i) => (
              <div key={i} className="welcome-column-card">
                <div className="fields-head">
                  <b>Column {i + 1}</b>
                  <button className="link danger" onClick={() => dropCol(i)} disabled={(el.columns || []).length <= 1}>Remove</button>
                </div>
                <label>Heading<input maxLength={256} value={c.heading || ''} placeholder="Socials" onChange={(e) => setCol(i, { heading: e.target.value })} /></label>
                <label>Content<textarea rows={4} maxLength={1024} value={c.content || ''} placeholder="[Website](https://…)&#10;[YouTube](https://…)" onChange={(e) => setCol(i, { content: e.target.value })} /></label>
              </div>
            ))}
          </div>
          {(el.columns || []).length < 3 && (
            <button className="link" onClick={addCol}>+ Add a column</button>
          )}
        </>
      )}
    </div>
  );
}

function AddElementMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  if (!open) return (
    <div className="actions" style={{ justifyContent: 'center', margin: '12px 0' }}>
      <button className="btn" onClick={() => setOpen(true)}>+ Add element</button>
    </div>
  );
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Pick an element type</h2>
      <div className="welcome-element-picker">
        {ELEMENT_TYPES.map((t) => (
          <button key={t.id} className="element-type-card" onClick={() => { onAdd(t.id); setOpen(false); }}>
            <b>{t.label}</b>
            <span className="muted">{t.hint}</span>
          </button>
        ))}
      </div>
      <div className="actions">
        <button className="link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </section>
  );
}

export default function WelcomeChannelPage() {
  const [page, setPage] = useState(null);
  const [guild, setGuild] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.guild(), api.getWelcomePage()])
      .then(([g, p]) => { setGuild(g); setPage(p); })
      .catch((e) => setStatus(e.message));
  }, []);
  if (!page || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const setEl = (idx, val) => setPage({ ...page, elements: page.elements.map((e, i) => (i === idx ? val : e)) });
  const addEl = (type) => setPage({ ...page, elements: [...page.elements, blank(type)] });
  const delEl = (idx) => setPage({ ...page, elements: page.elements.filter((_, i) => i !== idx) });
  const moveEl = (idx, dir) => {
    const next = page.elements.slice();
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setPage({ ...page, elements: next });
  };

  const save = async () => {
    setBusy(true); setStatus('Saving…');
    try {
      const saved = await api.saveWelcomePage({ channel_id: page.channel_id, elements: page.elements });
      setPage(saved);
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    setBusy(true); setStatus('Saving + publishing to channel…');
    try {
      const saved = await api.saveWelcomePage({ channel_id: page.channel_id, elements: page.elements });
      setPage(saved);
      const out = await api.publishWelcomePage();
      setStatus(`Published ${out.posted} element${out.posted === 1 ? '' : 's'} to the channel ✓`);
    } catch (e) { setStatus('Publish failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  const clearChannel = async () => {
    if (!window.confirm('Delete every published element message from the channel? The saved layout stays — you can republish anytime.')) return;
    setBusy(true); setStatus('Clearing channel…');
    try { await api.clearWelcomePage(); setStatus('Channel cleared ✓'); }
    catch (e) { setStatus('Clear failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <PageHeader title="Welcome Channel" sub="A multi-section landing page in one channel — banners, text blocks, columns of links. Each element posts as its own embed; Publish edits the existing messages in place, no duplicates.">
        <span className="status">{status}</span>
        <button className="link" onClick={save} disabled={busy}>Save draft</button>
        <button className="btn" onClick={publish} disabled={busy || !page.channel_id || !page.elements.length}>Publish to channel</button>
      </PageHeader>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Channel</h2>
        <label>Channel where the welcome page lives
          <select value={page.channel_id || ''} onChange={(e) => setPage({ ...page, channel_id: e.target.value || null })}>
            <option value="">— pick a channel —</option>
            {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <Callout type="tip">
          Best practice: make this a read-only channel (deny <code>Send Messages</code> for <code>@everyone</code>) so the page stays clean. The bot needs <b>Send Messages</b>, <b>Embed Links</b>, and <b>Manage Messages</b> here so it can edit and clean up its own posts.
        </Callout>
        {page.message_ids?.filter(Boolean).length > 0 && (
          <div className="actions">
            <button className="link danger" onClick={clearChannel} disabled={busy}>Delete all published messages</button>
            <span className="muted" style={{ fontSize: '0.85rem' }}>{page.message_ids.filter(Boolean).length} message(s) currently posted</span>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Page elements</h2>
        {page.elements.length === 0 ? (
          <div className="empty-state">
            <p>No elements yet. A typical welcome page is a series of banner + text pairs:</p>
            <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
              <li><b>Banner</b> (Welcome) → <b>Section</b> (server intro)</li>
              <li><b>Banner</b> (Links) → <b>Columns</b> (links + socials)</li>
              <li><b>Banner</b> (Rules) → <b>Section</b> (rules + SOP)</li>
              <li><b>Banner</b> (Invite) → <b>Section</b> (invite link)</li>
            </ul>
            <p className="muted">Start by adding a banner element below.</p>
          </div>
        ) : null}

        {page.elements.map((el, i) => (
          <ElementEditor
            key={i} idx={i} el={el}
            onChange={(v) => setEl(i, v)}
            onDelete={() => delEl(i)}
            onMoveUp={() => moveEl(i, -1)}
            onMoveDown={() => moveEl(i, +1)}
            canUp={i > 0}
            canDown={i < page.elements.length - 1}
          />
        ))}

        <AddElementMenu onAdd={addEl} />
      </section>

      <Callout type="tip">
        <b>Publishing is non-destructive.</b> The bot remembers which message it sent for each element. Saving + republishing edits those messages in place — your URLs and pins survive. Add/remove elements freely; we add new messages or delete extras on the next publish.
      </Callout>
    </div>
  );
}
