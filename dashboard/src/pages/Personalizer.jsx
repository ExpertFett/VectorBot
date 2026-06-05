import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const toHex = (n) => (typeof n === 'number' ? '#' + (n & 0xffffff).toString(16).padStart(6, '0') : '#5865f2');
const MAX_AVATAR_BYTES = 8 * 1024 * 1024; // 8 MB — matches the server-side raw body limit

export default function Personalizer() {
  const [cfg, setCfg] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => { api.getPersonalizer().then(setCfg).catch((e) => setStatus(e.message)); }, []);
  if (!cfg) return <div className="muted page">{status || 'Loading…'}</div>;

  const save = async () => {
    setStatus('Saving…');
    try {
      setCfg(await api.savePersonalizer({ bot_nickname: cfg.bot_nickname || null, embed_color: cfg.embed_color }));
      setStatus('Saved ✓');
    } catch (e) { setStatus('Save failed: ' + (e.body?.error || e.message)); }
  };

  const acceptFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setStatus('Drop an image file (PNG, JPG, GIF, WebP).');
    if (file.size > MAX_AVATAR_BYTES) return setStatus(`Image too large (max ${MAX_AVATAR_BYTES / 1024 / 1024} MB).`);
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result);
    reader.readAsDataURL(file);
    setStatus('');
  };

  const onDrop = (e) => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files?.[0]); };
  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const uploadAvatar = async () => {
    if (!avatarFile) return setStatus('Drop or choose an image first.');
    setStatus('Uploading avatar…');
    try {
      await api.uploadBotAvatar(avatarFile);
      setStatus('Avatar updated ✓ (may take a moment to show)');
      setAvatarFile(null); setAvatarPreview('');
    } catch (e) {
      setStatus('Upload failed: ' + (e.body?.error === 'avatar_failed' ? 'Discord rejected it (bad image or rate-limited).' : (e.body?.error || e.message)));
    }
  };

  const updateAvatarFromUrl = async () => {
    if (!avatarUrl) return setStatus('Enter an image URL.');
    setStatus('Updating avatar…');
    try { await api.setBotAvatar(avatarUrl); setStatus('Avatar updated ✓ (may take a moment to show)'); setAvatarUrl(''); }
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

        <div
          className={`avatar-drop${dragging ? ' dragover' : ''}`}
          onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button" tabIndex={0}
        >
          {avatarPreview
            ? <img className="avatar-preview" src={avatarPreview} alt="" />
            : <div className="avatar-drop-icon" aria-hidden="true">⤓</div>}
          <div>
            {avatarFile
              ? <><b>{avatarFile.name}</b> <span className="muted">({Math.round(avatarFile.size / 1024)} KB)</span></>
              : <>Drag &amp; drop an image here, or <span className="link">click to choose</span></>}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>PNG / JPG / GIF / WebP · square works best · max 8 MB</div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => acceptFile(e.target.files?.[0])} />
        </div>

        <div className="actions">
          <button className="btn" onClick={uploadAvatar} disabled={!avatarFile}>Update avatar</button>
          {avatarFile && <button className="link" onClick={() => { setAvatarFile(null); setAvatarPreview(''); }}>Clear</button>}
        </div>

        <details style={{ marginTop: 14 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>Or paste an image URL instead</summary>
          <div style={{ marginTop: 8 }}>
            <label>Image URL<input value={avatarUrl} placeholder="https://… (png/jpg)" onChange={(e) => setAvatarUrl(e.target.value)} /></label>
            <div className="actions"><button className="btn" onClick={updateAvatarFromUrl}>Update from URL</button></div>
          </div>
        </details>
      </section>
    </div>
  );
}
