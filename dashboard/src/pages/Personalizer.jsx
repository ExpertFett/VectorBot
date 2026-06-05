import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

const toHex = (n) => (typeof n === 'number' ? '#' + (n & 0xffffff).toString(16).padStart(6, '0') : '#5865f2');

export default function Personalizer() {
  const [cfg, setCfg] = useState(null);
  const [bot, setBot] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const loadBot = () => api.getCustomBot().then(setBot).catch(() => {});

  useEffect(() => {
    api.getPersonalizer().then(setCfg).catch((e) => setStatus(e.message));
    loadBot();
  }, []);
  if (!cfg) return <div className="muted page">{status || 'Loading…'}</div>;

  const save = async () => {
    setStatus('Saving…');
    try {
      setCfg(await api.savePersonalizer({ bot_nickname: cfg.bot_nickname || null, embed_color: cfg.embed_color }));
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };

  const connectBot = async () => {
    if (!token.trim()) return setStatus('Paste your bot token first.');
    setBusy(true);
    setStatus('Connecting your bot…');
    try {
      const r = await api.saveCustomBot(token.trim());
      setStatus(`Connected ✓ — running as ${r.bot_tag || 'your bot'}`);
      setToken('');
      await loadBot();
    } catch (e) {
      const code = e.body?.error;
      setStatus(code === 'invalid_token' ? 'That token doesn’t look right (too short).' :
        code === 'login_failed' ? `Discord rejected the token: ${e.body?.detail || 'invalid token'}` :
        'Connect failed: ' + (e.body?.error || e.message));
    } finally { setBusy(false); }
  };

  const disconnectBot = async () => {
    if (!window.confirm('Stop running your custom bot? The shared DCS:OPT bot will take over (re-invite it if you removed it).')) return;
    setBusy(true);
    setStatus('Disconnecting…');
    try {
      await api.removeCustomBot();
      setStatus('Disconnected ✓');
      await loadBot();
    } catch (e) { setStatus('Disconnect failed: ' + (e.body?.error || e.message)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <PageHeader title="Customize" sub="Per-server tweaks to how the bot shows up here, plus the path to running your own fully-branded instance.">
        <span className="status">{status}</span><button className="btn" onClick={save}>Save</button>
      </PageHeader>

      <section className="card">
        <h2>This server</h2>
        <p className="muted">These tweaks are <b>per-server</b> — what you set here doesn’t leak to any other server the bot is in.</p>
        <label>Bot nickname (this server)
          <input value={cfg.bot_nickname || ''} maxLength={32} placeholder="Leave blank to reset to the bot’s default"
            onChange={(e) => setCfg({ ...cfg, bot_nickname: e.target.value })} />
        </label>
        <label>Embed accent color
          <input type="color" value={toHex(cfg.embed_color)}
            onChange={(e) => setCfg({ ...cfg, embed_color: parseInt(e.target.value.slice(1), 16) })} />
        </label>
        <p className="muted">Accent color applies to every embed the bot generates (verification panel, tickets, giveaways, event sheets, social alerts…).</p>
      </section>

      <section className="card">
        <h2>Run your own bot for this server</h2>
        <p className="muted">Discord ties the bot’s <b>username, avatar, and banner</b> to the application itself — they’re global. The only way to give the bot a server-specific identity is to wire up your own Discord application; we’ll run a dedicated client with your token, and your server only sees your bot.</p>

        {bot?.running ? (
          <>
            <div className="custom-bot-status">
              {bot.bot_avatar && <img src={bot.bot_avatar} alt="" />}
              <div>
                <div><b>{bot.bot_tag || 'Custom bot'}</b> <span className="tag" style={{ background: 'var(--green)', color: '#fff' }}>RUNNING</span></div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>Application ID: <code>{bot.bot_id}</code></div>
              </div>
            </div>
            <Callout type="tip">
              Every feature in this dashboard is now driven by your bot for this server. If the shared DCS:OPT bot is still in your member list, kick it — your custom bot has taken over.
            </Callout>
            <div className="actions">
              <button className="link danger" onClick={disconnectBot} disabled={busy}>Disconnect &amp; revert to shared bot</button>
            </div>
          </>
        ) : (
          <>
            <Callout type="tip">
              <b>One-time setup on Discord’s side:</b>
              <ol>
                <li>Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">Discord Developer Portal</a> → <b>New Application</b>. Give it your squadron’s name; upload your avatar (and banner if you want).</li>
                <li>Go to <b>Bot</b> on the left → enable <b>Server Members Intent</b> and <b>Message Content Intent</b> (both are privileged but required for our features).</li>
                <li>Click <b>Reset Token</b> on that page and <b>copy</b> the new token. <b>Don’t share it</b> — it’s the key to your bot.</li>
                <li>Go to <b>OAuth2 → URL Generator</b>. Tick <code>bot</code> + <code>applications.commands</code>, paste this permissions integer in the field: <code>1099780156438</code>. Open the generated URL and invite your bot to <b>this</b> server.</li>
                <li>If the shared DCS:OPT bot is still in your server, kick it once your bot is running below — they shouldn’t both be there.</li>
              </ol>
            </Callout>

            <label>Bot token
              <input type="password" value={token} placeholder="Paste the token you copied from the Bot page"
                onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </label>
            <p className="muted" style={{ fontSize: '0.85rem' }}>Stored in the database for this guild only. Disconnect any time to revert.</p>
            <div className="actions">
              <button className="btn" onClick={connectBot} disabled={busy || !token.trim()}>Connect bot</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
