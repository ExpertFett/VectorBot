import { api } from '../api.js';
import Brand from '../components/Brand.jsx';

export default function Login({ noAccess, user }) {
  const error = new URLSearchParams(window.location.search).get('error');

  const switchAccount = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    window.location.href = '/auth/login';
  };

  return (
    <div className="center">
      <div className="login-card">
        <Brand variant="lg" />
        {noAccess ? (
          <>
            <p className="muted">
              Signed in as <b>{user?.username}</b>, but you don’t have <b>Manage Server</b>
              permission on this server.
            </p>
            <button className="btn" onClick={switchAccount}>Switch account</button>
          </>
        ) : (
          <>
            <p className="muted">Sign in with Discord to manage your server.</p>
            {error && <p className="error">Login error: {error.replace(/_/g, ' ')}</p>}
            <a className="btn discord" href="/auth/login">Login with Discord</a>
          </>
        )}
      </div>
    </div>
  );
}
