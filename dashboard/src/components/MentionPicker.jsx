// Reusable multi-role ping picker. Used anywhere the bot posts a message that
// can @-mention roles (events, announcements, scheduled messages).
//
// value:    array of tokens — role IDs (strings), 'everyone', 'here'
// onChange: (nextTokens) => void
// roles:    guild.roles from /api/guild ({ id, name, color })
//
// Renders @everyone / @here toggles plus a chip per role. Selected chips get a
// colored border. No dropdown — chips are faster to scan and multi-select.

export default function MentionPicker({ value = [], onChange, roles = [], label = 'Ping roles when this posts' }) {
  const tokens = Array.isArray(value) ? value : [];
  const has = (t) => tokens.includes(t);
  const toggle = (t) => onChange(has(t) ? tokens.filter((x) => x !== t) : [...tokens, t]);

  const sorted = roles.slice().sort((a, b) => (b.position || 0) - (a.position || 0));

  return (
    <div className="mention-picker">
      <div className="mention-picker-label">{label}</div>
      <div className="mention-chips">
        <button type="button" className={`mention-chip special${has('everyone') ? ' selected' : ''}`} onClick={() => toggle('everyone')}>@everyone</button>
        <button type="button" className={`mention-chip special${has('here') ? ' selected' : ''}`} onClick={() => toggle('here')}>@here</button>
        <span className="mention-divider" />
        {sorted.map((r) => {
          const selected = has(r.id);
          const color = '#' + (r.color || 0).toString(16).padStart(6, '0');
          return (
            <button type="button" key={r.id}
              className={`mention-chip${selected ? ' selected' : ''}`}
              onClick={() => toggle(r.id)}
              style={selected ? { borderColor: r.color ? color : 'var(--accent)' } : undefined}
              title={r.name}>
              <span className="role-dot" style={{ background: color }} />
              {r.name}
            </button>
          );
        })}
        {sorted.length === 0 && <span className="muted" style={{ fontSize: '0.85rem' }}>No roles found.</span>}
      </div>
      {tokens.length > 0 && (
        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>
          Will ping: {tokens.map((t) => t === 'everyone' ? '@everyone' : t === 'here' ? '@here' : (sorted.find((r) => r.id === t)?.name ? `@${sorted.find((r) => r.id === t).name}` : '@role')).join(', ')}
        </div>
      )}
    </div>
  );
}
