// Renders a Discord-like preview of an embed (+ optional plain message content).
export default function EmbedPreview({ embed, content }) {
  const e = embed || {};
  const barColor =
    typeof e.color === 'number'
      ? '#' + (e.color & 0xffffff).toString(16).padStart(6, '0')
      : typeof e.color === 'string' && e.color
        ? e.color
        : '#4f545c';

  const fields = Array.isArray(e.fields) ? e.fields.filter((f) => f.name || f.value) : [];

  return (
    <div className="dc-preview">
      {content && <div className="dc-content">{content}</div>}
      <div className="dc-embed" style={{ borderLeftColor: barColor }}>
        {e.thumbnail && <img className="dc-thumb" src={e.thumbnail} alt="" />}
        <div className="dc-embed-body">
          {e.author?.name && (
            <div className="dc-author">
              {e.author.icon_url && <img src={e.author.icon_url} alt="" />}
              <span>{e.author.name}</span>
            </div>
          )}
          {e.title && (e.url ? <a className="dc-title" href={e.url}>{e.title}</a> : <div className="dc-title">{e.title}</div>)}
          {e.description && <div className="dc-desc">{e.description}</div>}
          {fields.length > 0 && (
            <div className="dc-fields">
              {fields.map((f, i) => (
                <div className={`dc-field ${f.inline ? 'inline' : ''}`} key={i}>
                  <div className="dc-field-name">{f.name}</div>
                  <div className="dc-field-val">{f.value}</div>
                </div>
              ))}
            </div>
          )}
          {e.image && <img className="dc-image" src={e.image} alt="" />}
          {(e.footer?.text || e.timestamp) && (
            <div className="dc-footer">
              {e.footer?.icon_url && <img src={e.footer.icon_url} alt="" />}
              <span>{e.footer?.text}{e.footer?.text && e.timestamp ? ' • ' : ''}{e.timestamp ? 'Today at 00:00' : ''}</span>
            </div>
          )}
        </div>
      </div>
      <p className="preview-note">Placeholders like <code>{'{user}'}</code> render live when the bot posts.</p>
    </div>
  );
}
