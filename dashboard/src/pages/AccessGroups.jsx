import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

// Access Groups: named bundles of Discord roles (e.g. "JTAC", "GM", "ATC") that
// can be granted permission to perform specific gated bot actions. The page has
// two sections:
//   1. Groups — CRUD on the named groups, each holds N Discord roles
//   2. Permissions — for each gated action, pick who can do it:
//        admins only · specific groups · everyone

const MODE_LABELS = {
  admin: 'Admins only',
  groups: 'Specific groups',
  everyone: 'Everyone in the server',
};

const PRESETS = [
  { name: 'JTAC',  color: '#d97706', hint: 'Joint Terminal Attack Controllers — can run range ops and bomb-scoring' },
  { name: 'GM',    color: '#9119f5', hint: 'Game Masters / Mission staff — post events, send announcements' },
  { name: 'ATC',   color: '#0ea5e9', hint: 'Air Traffic Controllers — manage server status and player traffic' },
  { name: 'Senior Staff', color: '#22c55e', hint: 'Trusted leadership — everything short of full admin' },
];

function GroupCard({ group, guildRoles, onSave, onDelete }) {
  const [draft, setDraft] = useState(group);
  const dirty = JSON.stringify(draft) !== JSON.stringify(group);
  useEffect(() => { setDraft(group); }, [group.id, group.name, group.color, group.role_ids?.join(',')]);

  const toggleRole = (id) => {
    const has = draft.role_ids.includes(id);
    setDraft({ ...draft, role_ids: has ? draft.role_ids.filter((r) => r !== id) : [...draft.role_ids, id] });
  };

  const sortedRoles = useMemo(
    () => guildRoles.slice().sort((a, b) => b.position - a.position),
    [guildRoles],
  );

  return (
    <div className="card access-group-card">
      <div className="fields-head" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
          <input type="color" value={draft.color || '#9119f5'} onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            style={{ width: 36, height: 36, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            maxLength={80} style={{ fontWeight: 700, fontSize: '1.05rem', flex: 1 }} />
        </div>
        <div className="actions" style={{ margin: 0 }}>
          {dirty && <button className="btn" onClick={() => onSave(draft)}>Save</button>}
          <button className="link danger" onClick={() => onDelete(group.id)}>Delete</button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: '0.85rem', margin: '8px 0' }}>
        Members with <b>any</b> of these roles count as part of <b>{draft.name}</b>:
      </p>

      <div className="access-role-grid">
        {sortedRoles.map((r) => {
          const selected = draft.role_ids.includes(r.id);
          return (
            <button key={r.id}
              className={`access-role-chip${selected ? ' selected' : ''}`}
              onClick={() => toggleRole(r.id)}
              style={selected ? { borderColor: draft.color || '#9119f5' } : undefined}
              title={r.name}>
              <span className="role-dot" style={{ background: '#' + (r.color || 0).toString(16).padStart(6, '0') }} />
              {r.name}
            </button>
          );
        })}
      </div>
      {draft.role_ids.length === 0 && (
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>
          No roles assigned — this group exists but nobody is in it. Pick at least one role above.
        </p>
      )}
    </div>
  );
}

function PermissionRow({ action, override, groups, onChange }) {
  const mode = override?.mode || 'admin';
  const selectedGroupIds = override?.group_ids || [];
  const toggleGroup = (gid) => {
    const has = selectedGroupIds.includes(gid);
    onChange({ mode, group_ids: has ? selectedGroupIds.filter((g) => g !== gid) : [...selectedGroupIds, gid] });
  };
  return (
    <div className="permission-row">
      <div>
        <b>{action.label}</b>
        {action.hint && <div className="muted" style={{ fontSize: '0.82rem', marginTop: 3 }}>{action.hint}</div>}
      </div>
      <div className="permission-controls">
        <select value={mode} onChange={(e) => onChange({ mode: e.target.value, group_ids: selectedGroupIds })}>
          {Object.entries(MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {mode === 'groups' && (
          <div className="group-chips">
            {groups.length === 0 && <span className="muted" style={{ fontSize: '0.85rem' }}>No groups yet — create one above.</span>}
            {groups.map((g) => {
              const selected = selectedGroupIds.includes(g.id);
              return (
                <button key={g.id}
                  className={`group-chip${selected ? ' selected' : ''}`}
                  style={selected ? { borderColor: g.color || '#9119f5', background: (g.color || '#9119f5') + '22' } : undefined}
                  onClick={() => toggleGroup(g.id)}>
                  {g.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AccessGroups() {
  const [guild, setGuild] = useState(null);
  const [groups, setGroups] = useState(null);
  const [actions, setActions] = useState(null);
  const [perms, setPerms] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.guild(), api.getAccessGroups(), api.getActions(), api.getPermissions()])
      .then(([g, gr, ac, pr]) => { setGuild(g); setGroups(gr); setActions(ac); setPerms(pr); })
      .catch((e) => setStatus(e.message));
  }, []);
  if (!guild || !groups || !actions || !perms) return <div className="muted page">{status || 'Loading…'}</div>;

  const groupsByCategory = actions.reduce((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {});

  const createGroup = async (preset) => {
    setBusy(true); setStatus(preset ? `Creating ${preset.name}…` : 'Creating group…');
    try {
      const g = await api.createAccessGroup({
        name: preset?.name || 'New group',
        color: preset?.color || '#9119f5',
        role_ids: [],
      });
      setGroups([...groups, g]);
      setStatus(`Created ${g.name} — assign roles below.`);
    } catch (e) { setStatus('Create failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  const saveGroup = async (g) => {
    setBusy(true); setStatus(`Saving ${g.name}…`);
    try {
      const saved = await api.updateAccessGroup(g.id, g);
      setGroups(groups.map((gg) => (gg.id === saved.id ? saved : gg)));
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  const deleteGroup = async (id) => {
    if (!window.confirm('Delete this access group? Any permission overrides referencing it will be cleaned up.')) return;
    setBusy(true);
    try {
      await api.deleteAccessGroup(id);
      setGroups(groups.filter((g) => g.id !== id));
      // Re-pull perms — the backend strips the deleted id from overrides.
      setPerms(await api.getPermissions());
      setStatus('Deleted ✓');
    } catch (e) { setStatus('Delete failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  const updatePerm = (key, val) => setPerms({ ...perms, [key]: val });
  const savePermissions = async () => {
    setBusy(true); setStatus('Saving permissions…');
    try {
      const saved = await api.savePermissions(perms);
      setPerms(saved);
      setStatus('Permissions saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  const missingPresets = PRESETS.filter((p) => !groups.some((g) => g.name.toLowerCase() === p.name.toLowerCase()));

  return (
    <div className="page">
      <PageHeader title="Access Groups" sub="Named role bundles (JTAC, GM, ATC) that can be granted permission to perform specific bot actions. Admins (Manage Server) always pass every check — overrides only grant access to non-admins.">
        <span className="status">{status}</span>
        <button className="btn" onClick={savePermissions} disabled={busy}>Save permissions</button>
      </PageHeader>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Groups</h2>
        <p className="muted">A group is a set of Discord roles. Anyone who has any of those roles is part of the group. Then below, decide what each group is allowed to do.</p>

        {missingPresets.length > 0 && (
          <Callout type="tip">
            <b>Quick start:</b> we suggest a few groups common to flight-sim communities. Click one to add it:
            <div className="actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {missingPresets.map((p) => (
                <button key={p.name} className="link" onClick={() => createGroup(p)} disabled={busy}
                  style={{ border: `1px solid ${p.color}`, padding: '4px 10px', borderRadius: 6, color: p.color }}
                  title={p.hint}>
                  + {p.name}
                </button>
              ))}
            </div>
          </Callout>
        )}

        <div className="actions">
          <button className="btn" onClick={() => createGroup()} disabled={busy}>+ New group</button>
        </div>

        {groups.length === 0 && (
          <div className="empty-state" style={{ textAlign: 'center', padding: 30 }}>
            <p>No access groups yet. Create one above to start gating actions for non-admin members.</p>
          </div>
        )}

        {groups.map((g) => (
          <GroupCard key={g.id} group={g} guildRoles={guild.roles}
            onSave={saveGroup} onDelete={deleteGroup} />
        ))}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Permissions</h2>
        <p className="muted">For each action, decide whether <b>only admins</b> can do it (default), or whether members of <b>specific access groups</b> get permission, or whether <b>everyone</b> can.</p>

        {Object.entries(groupsByCategory).map(([cat, items]) => (
          <div key={cat} className="permission-category">
            <h3>{cat}</h3>
            {items.map((a) => (
              <PermissionRow key={a.key} action={a}
                override={perms[a.key]}
                groups={groups}
                onChange={(val) => updatePerm(a.key, val)} />
            ))}
          </div>
        ))}

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={savePermissions} disabled={busy}>Save permissions</button>
        </div>
      </section>

      <Callout>
        <b>Heads up:</b> overrides apply to bot-side commands and (rolling out feature-by-feature) the dashboard. Admins with <b>Manage Server</b> bypass every check — these overrides only grant or restrict access for <b>non-admins</b>. The bot owner is always allowed.
      </Callout>
    </div>
  );
}
