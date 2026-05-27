import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const ACTIONS = [
  { value: 'delete', label: 'Delete message' },
  { value: 'warn', label: 'Delete + warn' },
  { value: 'timeout', label: 'Delete + timeout 5m' },
];

function ActionSelect({ value, onChange }) {
  return (
    <label>Action
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
      </select>
    </label>
  );
}

function MultiCheck({ items, selected, onToggle, labelFn }) {
  return (
    <div className="multicheck">
      {items.length === 0 && <span className="muted">none</span>}
      {items.map((it) => (
        <label key={it.id} className="checkbox">
          <input type="checkbox" checked={selected.includes(it.id)} onChange={() => onToggle(it.id)} />
          {labelFn(it)}
        </label>
      ))}
    </div>
  );
}

export default function Automod() {
  const [cfg, setCfg] = useState(null);
  const [guild, setGuild] = useState(null);
  const [logChannel, setLogChannel] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([api.getAutomod(), api.guild(), api.getConfig()])
      .then(([a, g, c]) => { setCfg(a); setGuild(g); setLogChannel(c.log_channel_id || ''); })
      .catch((e) => setStatus('Failed to load: ' + (e.body?.error || e.message)));
  }, []);

  if (!cfg || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const setRule = (name, patch) =>
    setCfg({ ...cfg, rules: { ...cfg.rules, [name]: { ...cfg.rules[name], ...patch } } });
  const toggleExempt = (key, id) =>
    setCfg({ ...cfg, [key]: cfg[key].includes(id) ? cfg[key].filter((x) => x !== id) : [...cfg[key], id] });

  const save = async () => {
    setStatus('Saving…');
    try {
      const saved = await api.saveAutomod(cfg);
      await api.saveConfig({ log_channel_id: logChannel || null });
      setCfg(saved);
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };

  const r = cfg.rules;

  return (
    <div className="page">
      <PageHeader title="Auto-moderation" sub="Automatically filter spam, mass-mentions, banned words, invites and links.">
        <span className="status">{status}</span><button className="btn" onClick={save}>Save changes</button>
      </PageHeader>

      <section className="card">
        <h2>Log channel</h2>
        <p className="muted">Where automod and moderation actions are posted. Optional.</p>
        <select value={logChannel} onChange={(e) => setLogChannel(e.target.value)}>
          <option value="">— none —</option>
          {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
      </section>

      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={r.spam.enabled} onChange={(e) => setRule('spam', { enabled: e.target.checked })} /> <b>Spam filter</b></label>
        <p className="muted">Acts when a user sends too many messages too quickly.</p>
        <div className="row2">
          <label>Max messages<input type="number" min="2" value={r.spam.maxMessages} onChange={(e) => setRule('spam', { maxMessages: +e.target.value })} /></label>
          <label>Within (seconds)<input type="number" min="1" value={r.spam.perSeconds} onChange={(e) => setRule('spam', { perSeconds: +e.target.value })} /></label>
        </div>
        <ActionSelect value={r.spam.action} onChange={(v) => setRule('spam', { action: v })} />
      </section>

      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={r.mentions.enabled} onChange={(e) => setRule('mentions', { enabled: e.target.checked })} /> <b>Mass-mention filter</b></label>
        <div className="row2">
          <label>Max mentions<input type="number" min="1" value={r.mentions.maxMentions} onChange={(e) => setRule('mentions', { maxMentions: +e.target.value })} /></label>
          <ActionSelect value={r.mentions.action} onChange={(v) => setRule('mentions', { action: v })} />
        </div>
      </section>

      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={r.words.enabled} onChange={(e) => setRule('words', { enabled: e.target.checked })} /> <b>Blocked words</b></label>
        <label>Words (one per line)
          <textarea rows={4} value={(r.words.list || []).join('\n')}
            onChange={(e) => setRule('words', { list: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
        </label>
        <ActionSelect value={r.words.action} onChange={(v) => setRule('words', { action: v })} />
      </section>

      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={r.invites.enabled} onChange={(e) => setRule('invites', { enabled: e.target.checked })} /> <b>Block Discord invites</b></label>
        <ActionSelect value={r.invites.action} onChange={(v) => setRule('invites', { action: v })} />
      </section>

      <section className="card">
        <label className="checkbox"><input type="checkbox" checked={r.links.enabled} onChange={(e) => setRule('links', { enabled: e.target.checked })} /> <b>Block links</b></label>
        <p className="muted">Blocks all links except the allowed domains below.</p>
        <label>Allowed domains (one per line)
          <textarea rows={3} value={(r.links.allowed || []).join('\n')} placeholder={'youtube.com\ntenor.com'}
            onChange={(e) => setRule('links', { allowed: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
        </label>
        <ActionSelect value={r.links.action} onChange={(v) => setRule('links', { action: v })} />
      </section>

      <section className="card">
        <h2>Exemptions</h2>
        <p className="muted">Members with Manage Messages always bypass automod. Add extra exempt roles/channels:</p>
        <div className="row2">
          <div>
            <label>Exempt roles</label>
            <MultiCheck items={guild.roles} selected={cfg.exemptRoles} onToggle={(id) => toggleExempt('exemptRoles', id)} labelFn={(x) => x.name} />
          </div>
          <div>
            <label>Exempt channels</label>
            <MultiCheck items={guild.channels} selected={cfg.exemptChannels} onToggle={(id) => toggleExempt('exemptChannels', id)} labelFn={(x) => '#' + x.name} />
          </div>
        </div>
      </section>
    </div>
  );
}
