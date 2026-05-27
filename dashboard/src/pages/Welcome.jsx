import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';

const PLACEHOLDERS = '{user} · {username} · {server} · {membercount}';

function MessageSection({ title, hint, keys, cfg, setCfg, channels }) {
  const { channel, message, embed } = keys;
  const emb = cfg[embed];
  return (
    <section className="card">
      <h2>{title}</h2>
      {hint && <p className="muted">{hint}</p>}
      <label>Channel
        <select value={cfg[channel] || ''} onChange={(e) => setCfg({ ...cfg, [channel]: e.target.value || null })}>
          <option value="">— none (disabled) —</option>
          {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
      </label>
      <label>Message text <span className="hint">{PLACEHOLDERS}</span>
        <textarea rows={2} value={cfg[message] || ''} placeholder="Plain text (optional)"
          onChange={(e) => setCfg({ ...cfg, [message]: e.target.value })} />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={!!emb}
          onChange={(e) => setCfg({ ...cfg, [embed]: e.target.checked ? (emb || {}) : null })} />
        Include an embed
      </label>
      {emb && (
        <div className="embed-area">
          <EmbedBuilder value={emb} onChange={(v) => setCfg({ ...cfg, [embed]: v })} />
          <div className="preview-col">
            <div className="preview-label">Live preview</div>
            <EmbedPreview embed={emb} content={cfg[message]} />
          </div>
        </div>
      )}
    </section>
  );
}

export default function Welcome() {
  const [cfg, setCfg] = useState(null);
  const [guild, setGuild] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([api.getConfig(), api.guild()])
      .then(([c, g]) => { setCfg(c); setGuild(g); })
      .catch((e) => setStatus('Failed to load: ' + (e.body?.error || e.message)));
  }, []);

  if (!cfg || !guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const save = async () => {
    setStatus('Saving…');
    try {
      const saved = await api.saveConfig({
        welcome_channel_id: cfg.welcome_channel_id || null,
        welcome_message: cfg.welcome_message || null,
        welcome_embed: cfg.welcome_embed || null,
        goodbye_channel_id: cfg.goodbye_channel_id || null,
        goodbye_message: cfg.goodbye_message || null,
        goodbye_embed: cfg.goodbye_embed || null,
        autorole_id: cfg.autorole_id || null,
      });
      setCfg(saved);
      setStatus('Saved ✓');
    } catch (e) {
      setStatus('Save failed: ' + (e.body?.error || e.message));
    }
  };

  return (
    <div className="page">
      <PageHeader title="Welcome & Roles" sub="Greet new members, say goodbye to leavers, and auto-assign a role on join.">
        <span className="status">{status}</span>
        <button className="btn" onClick={save}>Save changes</button>
      </PageHeader>

      <MessageSection title="Welcome message"
        hint="Posted when a member joins."
        keys={{ channel: 'welcome_channel_id', message: 'welcome_message', embed: 'welcome_embed' }}
        cfg={cfg} setCfg={setCfg} channels={guild.channels} />

      <MessageSection title="Goodbye message"
        hint="Posted when a member leaves. (Mentions show as plain names.)"
        keys={{ channel: 'goodbye_channel_id', message: 'goodbye_message', embed: 'goodbye_embed' }}
        cfg={cfg} setCfg={setCfg} channels={guild.channels} />

      <section className="card">
        <h2>Auto-role</h2>
        <p className="muted">Automatically assigned to new members on join.</p>
        <select value={cfg.autorole_id || ''} onChange={(e) => setCfg({ ...cfg, autorole_id: e.target.value || null })}>
          <option value="">— none —</option>
          {guild.roles.map((r) => (
            <option key={r.id} value={r.id} disabled={!r.assignable}>
              {r.name}{r.assignable ? '' : ' (above bot — can’t assign)'}
            </option>
          ))}
        </select>
      </section>
    </div>
  );
}
