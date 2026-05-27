import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const BLANK = { user_id: '', callsign: '', airframes: '', quals: '', notes: '' };

export default function Roster() {
  const [roster, setRoster] = useState(null);
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(BLANK);
  const [csv, setCsv] = useState('');
  const [status, setStatus] = useState('');

  const load = () => api.getRoster().then(setRoster).catch((e) => setStatus(e.message));
  useEffect(() => {
    load();
    api.getMembers().then(setMembers).catch(() => setMembers([]));
  }, []);
  if (!roster) return <div className="muted page">{status || 'Loading…'}</div>;

  const tagOf = (id) => members.find((m) => m.id === id)?.tag || id;

  const save = async () => {
    if (!editing.user_id) return setStatus('Pick a member.');
    try {
      await api.saveRosterEntry(editing.user_id, editing);
      setStatus('Saved ✓'); setEditing(BLANK); load();
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };
  const del = async (userId) => { if (!window.confirm('Remove from roster?')) return; await api.deleteRosterEntry(userId); load(); };
  const edit = (r) => setEditing({ user_id: r.user_id, callsign: r.callsign || '', airframes: r.airframes || '', quals: r.quals || '', notes: r.notes || '' });

  const doImport = async () => {
    if (!csv.trim()) return setStatus('Paste CSV first.');
    try { const r = await api.importRoster(csv); setStatus(`Imported ${r.imported}/${r.total} rows.`); setCsv(''); load(); }
    catch (e) { setStatus('Import failed: ' + (e.body?.error || e.message)); }
  };

  return (
    <div className="page">
      <PageHeader title="Squadron Roster" sub="Track pilot callsigns, airframes and qualifications — import the whole squadron from a spreadsheet.">
        <span className="status">{status}</span>
      </PageHeader>

      <section className="card">
        <h2>{roster.some((r) => r.user_id === editing.user_id) ? 'Edit entry' : 'Add / edit pilot'}</h2>
        <div className="row2">
          <label>Member
            <select value={editing.user_id} onChange={(e) => setEditing({ ...editing, user_id: e.target.value })}>
              <option value="">— choose —</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.tag})</option>)}
            </select>
          </label>
          <label>Callsign<input value={editing.callsign} onChange={(e) => setEditing({ ...editing, callsign: e.target.value })} /></label>
        </div>
        <label>Airframes <span className="hint">comma-separated</span><input value={editing.airframes} placeholder="F/A-18C, F-16C" onChange={(e) => setEditing({ ...editing, airframes: e.target.value })} /></label>
        <label>Qualifications <span className="hint">e.g. CQ, Flight Lead, JTAC, GM, ATC</span><input value={editing.quals} placeholder="CQ, Flight Lead, JTAC" onChange={(e) => setEditing({ ...editing, quals: e.target.value })} /></label>
        <label>Notes<textarea rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
        <div className="actions"><button className="btn" onClick={save}>Save</button>{editing.user_id && <button className="link" onClick={() => setEditing(BLANK)}>Clear</button>}</div>
      </section>

      <section className="card">
        <h2>Roster ({roster.length})</h2>
        {roster.length === 0 ? <p className="muted">No pilots yet.</p> : (
          <table className="modlog">
            <thead><tr><th>Callsign</th><th>Pilot</th><th>Airframes</th><th>Quals</th><th /></tr></thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.user_id}>
                  <td><b>{r.callsign || '—'}</b></td>
                  <td className="muted">{tagOf(r.user_id)}</td>
                  <td>{r.airframes || '—'}</td>
                  <td>{r.quals || '—'}</td>
                  <td className="row-actions"><button className="link" onClick={() => edit(r)}>Edit</button><button className="link danger" onClick={() => del(r.user_id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>CSV import</h2>
        <p className="muted">Columns: <code>user_id</code> (or <code>username</code>), <code>callsign</code>, <code>airframes</code>, <code>quals</code>, <code>notes</code>. First row = headers.</p>
        <textarea rows={5} value={csv} placeholder={'username,callsign,airframes,quals\nFett,Viper,F/A-18C,Flight Lead'} onChange={(e) => setCsv(e.target.value)} />
        <div className="actions"><button className="btn" onClick={doImport}>Import</button></div>
      </section>
    </div>
  );
}
