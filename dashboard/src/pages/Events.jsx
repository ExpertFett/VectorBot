import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';

const BLANK = {
  id: null, title: '', description: '', mission: '', map: '', channel_id: '',
  start_at: '', reminder_minutes: 30, image: '', embed: null,
  waitlist: false, multi_signup: false, recur_days: 0,
  roles: [{ label: 'Attending', emoji: '✅', limit: 0, group: '', qual: '' }],
  taskings: {},
};

const RECUR_LABEL = (d) => (d === 1 ? 'daily' : d === 7 ? 'weekly' : d === 14 ? 'biweekly' : `every ${d}d`);

// Common DCS flight taskings — datalist suggestions, free text otherwise.
const TASKINGS = ['STRIKE', 'SEAD', 'DEAD', 'CAP', 'BARCAP', 'TARCAP', 'SWEEP', 'CAS', 'OCA', 'DCA', 'ESCORT', 'TANKER', 'AWACS', 'GCI', 'JTAC', 'MARSHAL', 'ANTI-SHIP', 'RECCE', 'ELINT', 'MOB'];

// One-click preset — adds each controller as its own flight so it appears as
// its own sign-up button on the embed. Limits are sensible defaults — every
// row is editable (rename, change limit, remove, add qual) after adding.
const CONTROLLERS = [
  { label: 'AWACS',   emoji: '', limit: 1, group: 'AWACS',   qual: '' },
  { label: 'GCI',     emoji: '', limit: 1, group: 'GCI',     qual: '' },
  { label: 'JTAC',    emoji: '', limit: 2, group: 'JTAC',    qual: '' },
  { label: 'LSO',     emoji: '', limit: 3, group: 'LSO',     qual: '' },
  { label: 'Marshal', emoji: '', limit: 2, group: 'Marshal', qual: '' },
  { label: 'ATC',     emoji: '', limit: 2, group: 'ATC',     qual: '' },
  { label: 'SOF',     emoji: '', limit: 1, group: 'SOF',     qual: '' },
];

// DCS modules that seat more than one crew -> import expands each jet into sub-positions.
const MULTICREW = {
  'F-14A-135-GR': ['Pilot', 'RIO'], 'F-14B': ['Pilot', 'RIO'],
  'F-15ESE': ['Pilot', 'WSO'],
  'AH-64D_BLK_II': ['Pilot', 'CPG'],
  'Mi-24P': ['Pilot', 'Gunner'], 'Mi-8MT': ['Pilot', 'Copilot'],
  'L-39ZA': ['Front', 'Rear'], 'L-39C': ['Front', 'Rear'],
  'C-101CC': ['Front', 'Rear'], 'C-101EB': ['Front', 'Rear'],
  'MB-339A': ['Front', 'Rear'], 'MB-339APAN': ['Front', 'Rear'],
  'Christen Eagle II': ['Front', 'Rear'], 'Yak-52': ['Front', 'Rear'],
};

// Convert a stored epoch-ms to a value for <input type="datetime-local">.
const toLocalInput = (ms) => {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

export default function Events() {
  const [list, setList] = useState(null);
  const [guild, setGuild] = useState(null);
  const [editing, setEditing] = useState(BLANK);
  const [status, setStatus] = useState('');
  const formRef = useRef(null);
  const scrollToForm = () => setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  const startNew = () => { setEditing(BLANK); setStatus(''); scrollToForm(); };

  const load = () => Promise.all([api.getEvents(), api.guild()])
    .then(([l, g]) => { setList(l); setGuild(g); }).catch((e) => setStatus(e.message));
  useEffect(() => { load(); }, []);
  if (!list || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const setRole = (i, patch) => setEditing({
    ...editing,
    roles: editing.roles.map((r, idx) => {
      if (idx !== i) return r;
      const next = { ...r, ...patch };
      // If the user is renaming a controller (label === group), keep the group
      // in sync so the embed's button label updates too — e.g. AWACS → EYESPY
      // renames both fields, not just the slot label.
      if (patch.label !== undefined && r.group && r.group === r.label) {
        next.group = patch.label;
      }
      return next;
    }),
  });
  const addRole = () => setEditing({ ...editing, roles: [...editing.roles, { label: '', emoji: '', limit: 0, group: '', qual: '' }] });
  const removeRole = (i) => setEditing({ ...editing, roles: editing.roles.filter((_, idx) => idx !== i) });
  const addControllers = () => {
    const have = new Set(editing.roles.map((r) => r.label));
    const added = CONTROLLERS.filter((c) => !have.has(c.label));
    setEditing({ ...editing, roles: [...editing.roles, ...added] });
  };
  const setTasking = (flight, val) => setEditing({
    ...editing,
    taskings: val ? { ...editing.taskings, [flight]: val } : Object.fromEntries(Object.entries(editing.taskings).filter(([k]) => k !== flight)),
  });
  // Derive unique flight names (preserving the order they first appear in roles).
  const flights = [];
  const seen = new Set();
  for (const r of editing.roles) {
    if (r.group && !seen.has(r.group)) { seen.add(r.group); flights.push(r.group); }
  }

  const importMiz = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('Parsing .miz…');
    try {
      const { slots } = await api.parseMiz(file);
      const have = new Set(editing.roles.map((r) => r.label));
      const imported = [];
      for (const s of slots) {
        const crew = MULTICREW[s.type];
        const positions = crew ? crew.map((c) => `${s.unit} – ${c}`) : [s.unit];
        for (const label of positions) {
          if (!have.has(label)) { imported.push({ label, emoji: '', limit: 1, group: s.group || s.type, qual: '' }); have.add(label); }
        }
      }
      setEditing({ ...editing, roles: [...editing.roles, ...imported] });
      setStatus(`Imported ${imported.length} slot(s) (${slots.length} jets found; multi-crew expanded).`);
    } catch (err) {
      setStatus('Import failed: ' + (err.body?.error || err.message));
    }
    e.target.value = '';
  };

  const save = async () => {
    if (!editing.title) return setStatus('Title is required.');
    if (!editing.start_at) return setStatus('Pick a start date/time.');
    const payload = {
      title: editing.title, description: editing.description || null, mission: editing.mission || null,
      map: editing.map || null, channel_id: editing.channel_id || null, image: editing.image || null,
      start_at: new Date(editing.start_at).toISOString(),
      reminder_minutes: editing.reminder_minutes,
      roles: editing.roles.filter((r) => r.label),
      embed: editing.embed || null,
      waitlist: editing.waitlist, multi_signup: editing.multi_signup,
      recur_days: editing.recur_days || 0,
      taskings: editing.taskings || {},
    };
    try {
      let id = editing.id;
      if (id) await api.updateEvent(id, payload);
      else { const r = await api.createEvent(payload); id = r.id; }
      setStatus('Saved ✓');
      setEditing({ ...editing, id });
      load();
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };

  const post = async (id) => { setStatus('Posting…'); try { await api.postEvent(id); setStatus('Posted ✓'); load(); } catch (e) { setStatus('Post failed: ' + (e.body?.error || e.message)); } };
  const cancel = async (id) => { if (!window.confirm('Cancel this event?')) return; await api.cancelEvent(id); load(); };
  const del = async (id) => { if (!window.confirm('Delete this event?')) return; await api.deleteEvent(id); if (editing.id === id) setEditing(BLANK); load(); };
  const edit = (e) => {
    setEditing({
      id: e.id, title: e.title, description: e.description || '', mission: e.mission || '', map: e.map || '',
      channel_id: e.channel_id || '', start_at: toLocalInput(e.start_at), reminder_minutes: e.reminder_minutes,
      image: e.image || '', embed: e.embed || null, waitlist: !!e.waitlist, multi_signup: !!e.multi_signup,
      recur_days: e.recur_days || 0,
      roles: e.roles?.length ? e.roles.map((r) => ({ ...r, qual: r.qual || '' })) : BLANK.roles,
      taskings: e.taskings || {},
    });
    scrollToForm();
  };

  return (
    <div className="page">
      <PageHeader title="Mission Events" sub="Schedule ops with airframe sign-up sheets — import slots straight from your .miz mission file.">
        <span className="status">{status}</span>
      </PageHeader>

      <section className="card">
        <div className="fields-head">
          <h2 style={{ margin: 0 }}>Events ({list.length})</h2>
          <button className="link" onClick={startNew}>+ New event</button>
        </div>
        {list.length === 0 ? <p className="muted">No events yet — click <b>+ New event</b> or fill in the form below to create your first.</p> : (
          <ul className="cmd-list">{list.map((e) => (
            <li key={e.id}>
              <span style={{ flex: 1 }}>
                <b>{e.title}</b>
                <span className="muted"> · {new Date(e.start_at).toLocaleString()} · {e.signups.length} signed up{e.recur_days ? ` · 🔁 ${RECUR_LABEL(e.recur_days)}` : ''}{e.status !== 'scheduled' ? ` · ${e.status}` : ''}</span>
              </span>
              <span className="row-actions">
                <button className="link" onClick={() => edit(e)}>Edit</button>
                <button className="link" onClick={() => post(e.id)}>Post</button>
                {e.status === 'scheduled' && <button className="link" onClick={() => cancel(e.id)}>Cancel</button>}
                <button className="link danger" onClick={() => del(e.id)}>Delete</button>
              </span>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="card" ref={formRef}>
        <h2>{editing.id ? `Edit event #${editing.id}` : 'New event'}</h2>
        <div className="row2">
          <label>Title<input value={editing.title} placeholder="Friday Night Ops" onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
          <label>Channel
            <select value={editing.channel_id} onChange={(e) => setEditing({ ...editing, channel_id: e.target.value })}>
              <option value="">— choose —</option>
              {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
        </div>
        <label>Description<textarea rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
        <div className="row2">
          <label>Mission<input value={editing.mission} placeholder="OP Northern Watch" onChange={(e) => setEditing({ ...editing, mission: e.target.value })} /></label>
          <label>Map / theatre<input value={editing.map} placeholder="Syria" onChange={(e) => setEditing({ ...editing, map: e.target.value })} /></label>
        </div>
        <div className="row2">
          <label>Start (your local time)<input type="datetime-local" value={editing.start_at} onChange={(e) => setEditing({ ...editing, start_at: e.target.value })} /></label>
          <label>Remind before (minutes, 0 = off)<input type="number" min="0" value={editing.reminder_minutes} onChange={(e) => setEditing({ ...editing, reminder_minutes: +e.target.value })} /></label>
        </div>
        <div className="row2">
          <label>Repeat <span className="hint">re-uses the sheet for the next date</span>
            <select value={editing.recur_days} onChange={(e) => setEditing({ ...editing, recur_days: +e.target.value })}>
              <option value={0}>No — one-off event</option>
              <option value={1}>Daily</option>
              <option value={7}>Weekly</option>
              <option value={14}>Every 2 weeks</option>
            </select>
          </label>
          <div />
        </div>
        <label className="checkbox"><input type="checkbox" checked={!!editing.embed} onChange={(e) => setEditing({ ...editing, embed: e.target.checked ? (editing.embed || {}) : null })} /> Use a custom embed header (the When + roster are always appended)</label>
        {editing.embed ? (
          <div className="embed-area">
            <EmbedBuilder value={editing.embed} onChange={(v) => setEditing({ ...editing, embed: v })} />
            <div className="preview-col"><div className="preview-label">Header preview</div><EmbedPreview embed={editing.embed} /></div>
          </div>
        ) : (
          <label>Image URL (optional)<input value={editing.image} placeholder="https://…" onChange={(e) => setEditing({ ...editing, image: e.target.value })} /></label>
        )}

        <div className="row2">
          <label className="checkbox"><input type="checkbox" checked={editing.waitlist} onChange={(e) => setEditing({ ...editing, waitlist: e.target.checked })} /> Waitlist when a slot is full (auto-promotes &amp; DMs)</label>
          <label className="checkbox"><input type="checkbox" checked={editing.multi_signup} onChange={(e) => setEditing({ ...editing, multi_signup: e.target.checked })} /> Allow signing up for multiple slots</label>
        </div>

        <div className="fields-head">
          <span>Slots / roles ({editing.roles.length}/100)</span>
          <span style={{ display: 'flex', gap: '12px' }}>
            <label className="link" style={{ cursor: 'pointer' }}>
              ⬆ Import .miz
              <input type="file" accept=".miz" style={{ display: 'none' }} onChange={importMiz} />
            </label>
            <button className="link" onClick={addControllers}>+ Add controllers</button>
            {editing.roles.length < 100 && <button className="link" onClick={addRole}>+ Add slot</button>}
          </span>
        </div>
        {editing.roles.map((r, i) => (
          <div className="event-role-row evt-qual" key={i}>
            <input placeholder="Slot / role (e.g. Winder 3-1)" value={r.label} onChange={(e) => setRole(i, { label: e.target.value })} />
            <input placeholder="Group (flight)" value={r.group || ''} onChange={(e) => setRole(i, { group: e.target.value })} />
            <input className="emoji-in" placeholder="🛩️" value={r.emoji} onChange={(e) => setRole(i, { emoji: e.target.value })} />
            <input type="number" min="0" placeholder="limit" value={r.limit} onChange={(e) => setRole(i, { limit: +e.target.value })} title="0 = unlimited" />
            <input placeholder="Req. qual" value={r.qual || ''} onChange={(e) => setRole(i, { qual: e.target.value })} title="Optional — only roster pilots whose quals include this can take the slot" />
            <button className="link danger" onClick={() => removeRole(i)}>✕</button>
          </div>
        ))}
        <p className="muted">Import a .miz to auto-fill flyable slots, or use <b>+ Add controllers</b> for one-click AWACS / GCI / JTAC / LSO / Marshal / ATC / SOF spots. Use <b>+ Add slot</b> to add a fully custom position from scratch. Each row is editable — rename the <b>Slot</b> label to whatever your group calls it (e.g. "AWACS" → "EYESPY") and the embed button follows automatically. The <b>Limit</b> field is how many people can sign up for that position (so set LSO to 3 for three LSOs, etc.); <b>0 = unlimited</b>. <b>Req. qual</b> 🔒 locks a slot to roster pilots holding that qualification. Times auto-convert per member.</p>

        {flights.length > 0 && (
          <>
            <div className="fields-head" style={{ marginTop: 14 }}>
              <span>Flight taskings</span>
              <span className="hint">shown on the flight button + roster</span>
            </div>
            <datalist id="dcs-taskings">{TASKINGS.map((t) => <option key={t} value={t} />)}</datalist>
            {flights.map((f) => (
              <div className="tasking-row" key={f}>
                <span>{f}</span>
                <input list="dcs-taskings" placeholder="e.g. STRIKE, SEAD, CAP…"
                  value={editing.taskings[f] || ''}
                  onChange={(e) => setTasking(f, e.target.value)} />
              </div>
            ))}
          </>
        )}

        <div className="actions">
          <button className="btn" onClick={save}>{editing.id ? 'Save' : 'Create'}</button>
          {editing.id && <button className="btn" onClick={() => post(editing.id)}>Post / Update in Discord</button>}
          {editing.id && <button className="link" onClick={() => setEditing(BLANK)}>New event</button>}
        </div>
      </section>

    </div>
  );
}
