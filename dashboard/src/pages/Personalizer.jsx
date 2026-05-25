import { useEffect, useState } from 'react';
import { api } from '../api.js';

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
      <header className="page-head"><h1>Personalizer</h1>
        <div className="actions"><span className="status">{status}</span><button className="btn" onClick={save}>Save</button></div>
      </header>
      <section className="card">
        <h2>This server</h2>
        <p className="muted">The bot’s username and avatar are global (set in the Developer Portal). Per-server you can set its nickname and an accent color used on bot-generated embeds (verification, tickets, giveaways).</p>
        <label>Bot nickname (this server)
          <input value={cfg.bot_nickname || ''} maxLength={32} placeholder="Leave blank to reset"
            onChange={(e) => setCfg({ ...cfg, bot_nickname: e.target.value })} />
        </label>
        <label>Embed accent color
          <input type="color" value={toHex(cfg.embed_color)}
            onChange={(e) => setCfg({ ...cfg, embed_color: parseInt(e.target.value.slice(1), 16) })} />
        </label>
      </section>
    </div>
  );
}
