import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

const PLACEHOLDERS = '{user} · {username} · {displayname} · {tag} · {avatar} · {server} · {membercount}';
const fmt = (ts) => new Date(ts).toLocaleString();

// Drop-in welcome card. {avatar} resolves to the joining member's profile
// picture at runtime; the other placeholders fill in their name + server info.
const WELCOME_CARD = {
  author: { name: '{server}' },
  title: 'Welcome, {displayname}!',
  description: 'Glad to have you here, {user}. Make yourself at home — check the rules channel and grab some roles to get started.',
  thumbnail: '{avatar}',
  footer: { text: 'Member #{membercount}' },
};
const GOODBYE_CARD = {
  author: { name: '{server}' },
  title: 'Goodbye, {displayname}.',
  description: 'Take care, {username}. Hope to see you again sometime.',
  thumbnail: '{avatar}',
  footer: { text: '{membercount} members remaining' },
};

function MessageSection({ title, hint, keys, cfg, setCfg, channels, onTest, busy, cardTemplate }) {
  const { channel, message, embed } = keys;
  const emb = cfg[embed];
  const channelSet = !!cfg[channel];
  const useCard = () => setCfg({ ...cfg, [embed]: { ...cardTemplate } });
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
      <div className="fields-head" style={{ alignItems: 'center' }}>
        <label className="checkbox" style={{ margin: 0 }}>
          <input type="checkbox" checked={!!emb}
            onChange={(e) => setCfg({ ...cfg, [embed]: e.target.checked ? (emb || cardTemplate) : null })} />
          Include an embed
        </label>
        <button className="link" onClick={useCard}>Use welcome-card template</button>
      </div>
      {emb && (
        <div className="embed-area">
          <EmbedBuilder value={emb} onChange={(v) => setCfg({ ...cfg, [embed]: v })} />
          <div className="preview-col">
            <div className="preview-label">Live preview <span className="hint">(placeholders shown literally — they fill in per-member at runtime)</span></div>
            <EmbedPreview embed={emb} content={cfg[message]} />
          </div>
        </div>
      )}
      <div className="actions">
        <button className="btn" onClick={onTest} disabled={!channelSet || busy}>Send test to channel</button>
        <span className="muted hint">Posts a real message using YOU as the test member.</span>
      </div>
    </section>
  );
}

export default function Welcome() {
  const [cfg, setCfg] = useState(null);
  const [guild, setGuild] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const loadLog = () => api.getWelcomeLog().then(setLog).catch(() => {});

  useEffect(() => {
    Promise.all([api.getConfig(), api.guild()])
      .then(([c, g]) => { setCfg(c); setGuild(g); })
      .catch((e) => setStatus('Failed to load: ' + (e.body?.error || e.message)));
    loadLog();
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

  const test = async (kind) => {
    setBusy(true);
    setStatus(`Saving + sending test ${kind}…`);
    try {
      // Save first so the test reflects whatever's currently in the form.
      await api.saveConfig({
        welcome_channel_id: cfg.welcome_channel_id || null,
        welcome_message: cfg.welcome_message || null,
        welcome_embed: cfg.welcome_embed || null,
        goodbye_channel_id: cfg.goodbye_channel_id || null,
        goodbye_message: cfg.goodbye_message || null,
        goodbye_embed: cfg.goodbye_embed || null,
        autorole_id: cfg.autorole_id || null,
      });
      await api.testWelcome(kind);
      setStatus(`Test ${kind} sent ✓`);
      loadLog();
    } catch (e) {
      setStatus(`Test ${kind} failed: ` + (e.body?.detail || e.body?.error || e.message));
    } finally { setBusy(false); }
  };

  const deleteLogEntry = async (id) => {
    if (!window.confirm('Delete this message from Discord too?')) return;
    try { await api.deleteWelcomeLog(id); loadLog(); }
    catch (e) { setStatus('Delete failed: ' + (e.body?.error || e.message)); }
  };

  const channelOf = (id) => guild.channels.find((c) => c.id === id);

  return (
    <div className="page">
      <PageHeader title="Welcome & Roles">
        <div className="actions">
          <span className="status">{status}</span>
          <button className="btn" onClick={save}>Save changes</button>
        </div>
      </PageHeader>

      <Callout>
        Welcome and goodbye messages auto-fire when someone joins or leaves — there’s no "post panel" button. Use <b>Send test to channel</b> below to verify your message looks right and the bot can post to that channel.
      </Callout>

      <MessageSection title="Welcome message"
        hint="Posted when a member joins."
        keys={{ channel: 'welcome_channel_id', message: 'welcome_message', embed: 'welcome_embed' }}
        cfg={cfg} setCfg={setCfg} channels={guild.channels}
        onTest={() => test('welcome')} busy={busy} cardTemplate={WELCOME_CARD} />

      <MessageSection title="Goodbye message"
        hint="Posted when a member leaves. (Mentions show as plain names.)"
        keys={{ channel: 'goodbye_channel_id', message: 'goodbye_message', embed: 'goodbye_embed' }}
        cfg={cfg} setCfg={setCfg} channels={guild.channels}
        onTest={() => test('goodbye')} busy={busy} cardTemplate={GOODBYE_CARD} />

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

      <section className="card">
        <h2>Recent posts ({log.length})</h2>
        <p className="muted">Every welcome and goodbye the bot has actually posted — including test sends from above. Click <b>Delete</b> to pull a message back out of Discord.</p>
        {log.length === 0 ? (
          <p className="muted">No welcome or goodbye messages have been posted yet. Send a test above to verify everything’s wired up.</p>
        ) : (
          <ul className="cmd-list">{log.map((e) => {
            const ch = channelOf(e.channel_id);
            return (
              <li key={e.id}>
                <span style={{ flex: 1 }}>
                  <span className="tag" style={{ background: e.kind === 'welcome' ? 'var(--green)' : 'var(--bg)' }}>{e.kind}</span>
                  {e.test && <span className="tag" style={{ marginLeft: 6 }}>TEST</span>}
                  <span style={{ marginLeft: 6 }}><b>{e.user_tag || e.user_id || 'unknown'}</b></span>
                  <span className="muted"> · #{ch ? ch.name : e.channel_id} · {fmt(e.created_at)}</span>
                </span>
                <span className="row-actions">
                  {e.message_id && <button className="link danger" onClick={() => deleteLogEntry(e.id)}>Delete</button>}
                </span>
              </li>
            );
          })}</ul>
        )}
      </section>
    </div>
  );
}
