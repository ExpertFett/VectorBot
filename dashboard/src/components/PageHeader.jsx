// Standard page header: title + optional one-line description, with optional
// right-aligned actions (save button, status text, etc.) passed as children.
export default function PageHeader({ title, sub, children }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children != null && <div className="actions">{children}</div>}
    </header>
  );
}
