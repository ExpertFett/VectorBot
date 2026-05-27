// Friendly placeholder for empty lists/boards.
export default function EmptyState({ icon = '📭', children }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      {children}
    </div>
  );
}
