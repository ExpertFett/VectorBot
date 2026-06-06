import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

const blankAutomation = () => ({
  name: 'New automation',
  enabled: true,
  trigger_type: 'member.join',
  trigger_params: {},
  actions: [],
});

// Render a single param input based on registry metadata.
function ParamInput({ def, value, onChange, guild }) {
  const v = value ?? '';
  if (def.type === 'role') {
    return (
      <label>{def.label}{def.required && ' *'}
        <select value={v} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— choose —</option>
          {guild.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
    );
  }
  if (def.type === 'channel') {
    return (
      <label>{def.label}{def.required && ' *'}
        <select value={v} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— choose —</option>
          {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
      </label>
    );
  }
  if (def.type === 'textarea') {
    return (
      <label>{def.label}{def.required && ' *'}
        <textarea rows={3} placeholder={def.placeholder || ''} value={v} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  return (
    <label>{def.label}{def.required && ' *'}
      <input type="text" placeholder={def.placeholder || ''} value={v} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ActionRow({ idx, action, def, onChange, onRemove, onMoveUp, onMoveDown, canUp, canDown, guild }) {
  return (
    <div className="card automation-action">
      <div className="fields-head" style={{ alignItems: 'center' }}>
        <div><span className="tag" style={{ background: 'var(--accent)', color: '#fff', fontSize: '0.7rem', textTransform: 'uppercase' }}>Step {idx + 1}</span>
          <b style={{ marginLeft: 8 }}>{def?.label || action.type}</b></div>
        <div className="actions" style={{ margin: 0 }}>
          <button className="link" onClick={onMoveUp} disabled={!canUp}>↑</button>
          <button className="link" onClick={onMoveDown} disabled={!canDown}>↓</button>
          <button className="link danger" onClick={onRemove}>Remove</button>
        </div>
      </div>
      {def?.params.map((p) => (
        <ParamInput key={p.key} def={p} guild={guild}
          value={action.params?.[p.key]}
          onChange={(v) => onChange({ ...action, params: { ...action.params, [p.key]: v } })} />
      ))}
    </div>
  );
}

function AutomationEditor({ draft, setDraft, registry, guild, onSave, onDelete, onCancel, busy }) {
  const trigger = registry.triggers.find((t) => t.key === draft.trigger_type);
  const validActions = registry.actions.filter((a) => !a.appliesTo || a.appliesTo.includes(draft.trigger_type));

  const setAction = (i, val) => setDraft({ ...draft, actions: draft.actions.map((a, k) => (k === i ? val : a)) });
  const removeAction = (i) => setDraft({ ...draft, actions: draft.actions.filter((_, k) => k !== i) });
  const moveAction = (i, dir) => {
    const next = draft.actions.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setDraft({ ...draft, actions: next });
  };
  const addAction = (type) => {
    const def = validActions.find((a) => a.key === type);
    if (!def) return;
    const initParams = {};
    for (const p of def.params) initParams[p.key] = '';
    setDraft({ ...draft, actions: [...draft.actions, { type, params: initParams }] });
  };

  return (
    <section className="card automation-edit">
      <div className="fields-head" style={{ alignItems: 'center' }}>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          maxLength={120} style={{ fontWeight: 700, fontSize: '1.1rem', flex: 1 }} />
        <div className="actions" style={{ margin: 0 }}>
          <label className="checkbox" style={{ margin: 0 }}>
            <input type="checkbox" checked={!!draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            Enabled
          </label>
          {onDelete && <button className="link danger" onClick={onDelete} disabled={busy}>Delete</button>}
          <button className="link" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn" onClick={onSave} disabled={busy || !draft.actions.length}>Save</button>
        </div>
      </div>

      <h3 style={{ marginTop: 12 }}>1. When this happens</h3>
      <label>Trigger
        <select value={draft.trigger_type} onChange={(e) => setDraft({ ...draft, trigger_type: e.target.value, trigger_params: {}, actions: [] })}>
          {registry.triggers.map((t) => (
            <option key={t.key} value={t.key}>{t.category} — {t.label}</option>
          ))}
        </select>
      </label>
      {trigger?.params.map((p) => (
        <ParamInput key={p.key} def={p} guild={guild}
          value={draft.trigger_params?.[p.key]}
          onChange={(v) => setDraft({ ...draft, trigger_params: { ...draft.trigger_params, [p.key]: v } })} />
      ))}

      <h3 style={{ marginTop: 18 }}>2. Then do…</h3>
      {draft.actions.length === 0 && (
        <p className="muted">Add at least one action below.</p>
      )}
      {draft.actions.map((a, i) => (
        <ActionRow key={i} idx={i} action={a}
          def={registry.actions.find((x) => x.key === a.type)}
          guild={guild}
          onChange={(v) => setAction(i, v)}
          onRemove={() => removeAction(i)}
          onMoveUp={() => moveAction(i, -1)}
          onMoveDown={() => moveAction(i, +1)}
          canUp={i > 0} canDown={i < draft.actions.length - 1} />
      ))}
      <div className="action-picker">
        <span className="muted">Add an action:</span>
        {validActions.map((a) => (
          <button key={a.key} className="link" onClick={() => addAction(a.key)}>+ {a.label}</button>
        ))}
      </div>
    </section>
  );
}

function AutomationCard({ rule, registry, onEdit, onToggle, onDelete }) {
  const trigger = registry.triggers.find((t) => t.key === rule.trigger_type);
  return (
    <div className="card automation-row">
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <b style={{ fontSize: '1.05rem' }}>{rule.name}</b>
          {!rule.enabled && <span className="tag" style={{ background: '#444', color: '#aaa', fontSize: '0.7rem' }}>DISABLED</span>}
        </div>
        <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
          When <b>{trigger?.label || rule.trigger_type}</b> → {rule.actions.length} action{rule.actions.length === 1 ? '' : 's'}
          {rule.fire_count > 0 && <> · fired {rule.fire_count.toLocaleString()} time{rule.fire_count === 1 ? '' : 's'}</>}
        </div>
      </div>
      <div className="actions" style={{ margin: 0 }}>
        <button className="link" onClick={onToggle}>{rule.enabled ? 'Disable' : 'Enable'}</button>
        <button className="link" onClick={onEdit}>Edit</button>
        <button className="link danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

export default function Automations() {
  const [rules, setRules] = useState(null);
  const [registry, setRegistry] = useState(null);
  const [guild, setGuild] = useState(null);
  const [editing, setEditing] = useState(null);     // {id?, draft}
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.getAutomations(), api.getAutomationsRegistry(), api.guild()])
      .then(([r, reg, g]) => { setRules(r); setRegistry(reg); setGuild(g); })
      .catch((e) => setStatus(e.body?.error || e.message));
  }, []);
  if (!rules || !registry || !guild) {
    if (status === 'admin_only') return (
      <div className="page"><Callout type="warn">Automations is admin-only — Manage Server required.</Callout></div>
    );
    return <div className="muted page">{status || 'Loading…'}</div>;
  }

  const startCreate = () => setEditing({ id: null, draft: blankAutomation() });
  const startEdit = (rule) => setEditing({ id: rule.id, draft: structuredClone(rule) });
  const cancelEdit = () => { setEditing(null); setStatus(''); };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true); setStatus('Saving…');
    try {
      const payload = {
        name: editing.draft.name, enabled: editing.draft.enabled,
        trigger_type: editing.draft.trigger_type, trigger_params: editing.draft.trigger_params,
        actions: editing.draft.actions,
      };
      if (editing.id) {
        const updated = await api.updateAutomation(editing.id, payload);
        setRules(rules.map((r) => (r.id === editing.id ? updated : r)));
      } else {
        const created = await api.createAutomation(payload);
        setRules([...rules, created]);
      }
      setEditing(null);
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  const toggleRule = async (rule) => {
    setBusy(true);
    try {
      const updated = await api.updateAutomation(rule.id, {
        name: rule.name, enabled: !rule.enabled,
        trigger_type: rule.trigger_type, trigger_params: rule.trigger_params,
        actions: rule.actions,
      });
      setRules(rules.map((r) => (r.id === rule.id ? updated : r)));
      setStatus(`${updated.enabled ? 'Enabled' : 'Disabled'} ✓`);
    } catch (e) { setStatus('Failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  const removeRule = async (rule) => {
    if (!window.confirm(`Delete "${rule.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteAutomation(rule.id);
      setRules(rules.filter((r) => r.id !== rule.id));
      setStatus('Deleted ✓');
    } catch (e) { setStatus('Delete failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <PageHeader title="Automations" sub="When-this-then-that rules. Wire common server flows (auto-DM new joiners, mention staff on a keyword, swap roles on verification) without writing code.">
        <span className="status">{status}</span>
        {!editing && <button className="btn" onClick={startCreate}>+ New automation</button>}
      </PageHeader>

      {editing && (
        <AutomationEditor
          draft={editing.draft}
          setDraft={(d) => setEditing({ ...editing, draft: d })}
          registry={registry} guild={guild} busy={busy}
          onSave={saveEdit}
          onCancel={cancelEdit}
          onDelete={editing.id ? () => removeRule({ id: editing.id, name: editing.draft.name }).then(() => setEditing(null)) : null}
        />
      )}

      {!editing && rules.length === 0 && (
        <section className="card empty-state">
          <h2 style={{ marginTop: 0 }}>No automations yet</h2>
          <p>Click <b>+ New automation</b> to wire one up. Common examples:</p>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li><b>When a member joins</b> → DM them a welcome packet</li>
            <li><b>When a member completes verification</b> → swap their "Unverified" role for "Verified"</li>
            <li><b>When a message contains "help"</b> → react with 🫡 and ping staff</li>
            <li><b>When a ticket opens</b> → send a "we got your ticket" DM and add a "Has Ticket" role</li>
          </ul>
        </section>
      )}

      {!editing && rules.map((r) => (
        <AutomationCard key={r.id} rule={r} registry={registry}
          onEdit={() => startEdit(r)}
          onToggle={() => toggleRule(r)}
          onDelete={() => removeRule(r)} />
      ))}

      {!editing && rules.length > 0 && (
        <Callout type="tip">
          Placeholders you can use in message/DM text: <code>{'{user}'}</code> · <code>{'{username}'}</code> · <code>{'{displayname}'}</code> · <code>{'{tag}'}</code> · <code>{'{server}'}</code> · <code>{'{membercount}'}</code>. They fill in per-firing.
        </Callout>
      )}
    </div>
  );
}
