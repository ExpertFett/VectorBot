import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const toHex = (n) => (typeof n === 'number' ? '#' + (n & 0xffffff).toString(16).padStart(6, '0') : '#5865f2');

export default function Personalizer() {
  const [cfg, setCfg] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState('');
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

  const updateAvatar = async () => {
    if (!avatarUrl) return setStatus('Enter an image URL.');
    setStatus('Updating avatar…');
    try { await api.setBotAvatar(avatarUrl); setStatus('Avatar updated ✓ (may take a moment to show)'); }
    catch (e) { setStatus('Avatar failed: ' + (e.body?.error === 'avatar_failed' ? 'Discord rejected it (bad image or rate-limited).' : (e.body?.error || e.message))); }
  };

  return (
    <div className="page">
      <PageHeader title="Personalizer" sub="Customise the bot’s per-server nickname and the accent color used on its embeds.">
        <span className="status">{status}</span><button className="btn" onClick={save}>Save</button>
      </PageHeader>
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

      <section className="card">
        <h2>Bot avatar</h2>
        <p className="muted"><b>Global:</b> the bot has one avatar across <i>every</i> server it’s in — changing it here changes it everywhere. Discord rate-limits avatar changes, so don’t spam it.</p>
        <label>Image URL<input value={avatarUrl} placeholder="https://… (png/jpg)" onChange={(e) => setAvatarUrl(e.target.value)} /></label>
        <div className="actions"><button className="btn" onClick={updateAvatar}>Update avatar</button></div>
      </section>
    </div>
  );
}
