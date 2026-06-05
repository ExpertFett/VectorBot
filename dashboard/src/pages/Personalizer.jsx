import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

const toHex = (n) => (typeof n === 'number' ? '#' + (n & 0xffffff).toString(16).padStart(6, '0') : '#5865f2');

export default function Personalizer() {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => { api.getPersonalizer().then(setCfg).catch((e) => setStatus(e.message)); }, []);
  if (!cfg) return <div className="muted page">{status || 'Loading…'}</div>;

  const save = async () => {
    setStatus('Saving…');
    try {
      setCfg(await api.savePersonalizer({ bot_nickname: cfg.bot_nickname || null, embed_color: cfg.embed_color }));
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
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
        <h2>Want your own custom-branded bot?</h2>
        <p className="muted">Discord ties the bot’s <b>username, avatar, and banner</b> to the underlying application — they’re global across every server the bot is in. There’s no way for the bot to look one way here and a different way somewhere else.</p>
        <p className="muted">The workaround that Mee6 and similar bots offer (and the only way Discord lets this work) is to <b>run your own copy of the bot</b> under your own Discord application. Your application = your username, avatar, banner, status — your server only sees that one.</p>

        <Callout type="tip">
          <b>The high-level steps look like this:</b>
          <ol>
            <li>Create a new application in the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">Discord Developer Portal</a> — give it your group’s name, upload your avatar/banner there.</li>
            <li>Add a bot to the app, copy its token, enable the privileged intents (Server Members + Message Content).</li>
            <li>Invite your bot to your server with the install URL the portal gives you.</li>
            <li>Paste the token into a “Run my own bot” page here — we spin up a dedicated bot instance just for your server using your token.</li>
            <li>Remove DCS:OPT’s shared bot from your server (your custom one takes over every feature).</li>
          </ol>
        </Callout>

        <Callout type="warn">
          <b>Status: planned, not built yet.</b> Steps 1–3 you can do on the Developer Portal today; step 4 needs multi-tenant runtime work on our side (spawning a separate Discord client per token, routing every interaction / scheduled message / DCS hook event through the right bot). It’s a real feature, just not finished — I didn’t want to ship a token input that secretly does nothing. When the runtime lands this section turns into the actual setup form.
        </Callout>
      </section>
    </div>
  );
}
