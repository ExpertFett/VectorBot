// Instruction / info box. type: '' (info, blurple), 'tip' (orange), 'warn' (red).
export default function Callout({ icon, type = '', children }) {
  const fallback = type === 'warn' ? '⚠️' : type === 'tip' ? '💡' : 'ℹ️';
  return (
    <div className={`callout${type ? ' ' + type : ''}`}>
      <span className="callout-icon" aria-hidden="true">{icon || fallback}</span>
      <div>{children}</div>
    </div>
  );
}
