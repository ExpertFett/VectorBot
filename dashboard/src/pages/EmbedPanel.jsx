import { useEffect, useState } from 'react';
import { api } from '../api.js';
import EmbedBuilder from '../components/EmbedBuilder.jsx';
import EmbedPreview from '../components/EmbedPreview.jsx';

export default function EmbedPanel() {
  const [guild, setGuild] = useState(null);
  const [channelId, setChannelId] = useState('');
  const [content, setContent] = useState('');
  const [embed, setEmbed] = useState({});
  const [useEmbed, setUseEmbed] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => { api.guild().then(setGuild).catch((e) => setStatus(e.message)); }, []);
  if (!guild) return <div className="muted page">{status || 'Loading…'}</div>;

  const send = async () => {
    if (!channelId) return setStatus('Pick a channel.');
    if (!content && !useEmbed) return setStatus('Add a message or an embed.');
    try {
      await api.announce({ channel_id: channelId, content: content || null, embed: useEmbed ? embed : null });
      setStatus('Sent ✓');
    } catch (e) { setStatus('Send failed: ' + (e.body?.error || e.message)); }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Send Embed</h1>
        <div className="actions"><span className="status">{status}</span><button className="btn" onClick={send}>Send now</button></div>
      </header>
      <section className="card">
        <label>Channel
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">— choose —</option>
            {guild.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <label>Message text<textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Optional text above the embed" /></label>
        <label className="checkbox"><input type="checkbox" checked={useEmbed} onChange={(e) => setUseEmbed(e.target.checked)} /> Include an embed</label>
        {useEmbed && (
          <div className="embed-area">
            <EmbedBuilder value={embed} onChange={setEmbed} />
            <div className="preview-col"><div className="preview-label">Preview</div><EmbedPreview embed={embed} content={content} /></div>
          </div>
        )}
      </section>
    </div>
  );
}
