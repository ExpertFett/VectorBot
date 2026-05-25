import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Welcome from './pages/Welcome.jsx';
import Commands from './pages/Commands.jsx';
import Automod from './pages/Automod.jsx';
import RoleMenus from './pages/RoleMenus.jsx';
import Moderation from './pages/Moderation.jsx';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    api.me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Login />;
  if (!user.canManage) return <Login noAccess user={user} />;

  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Vector<span>Bot</span></div>
        <nav>
          <NavLink to="/welcome">Welcome &amp; Roles</NavLink>
          <NavLink to="/commands">Custom Commands</NavLink>
          <NavLink to="/automod">Auto-moderation</NavLink>
          <NavLink to="/rolemenus">Reaction Roles</NavLink>
          <NavLink to="/moderation">Moderation</NavLink>
        </nav>
        <div className="user">
          {user.avatar && <img src={user.avatar} alt="" />}
          <span className="uname">{user.username}</span>
          <button className="link" onClick={logout}>Logout</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/commands" element={<Commands />} />
          <Route path="/automod" element={<Automod />} />
          <Route path="/rolemenus" element={<RoleMenus />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="*" element={<Navigate to="/welcome" replace />} />
        </Routes>
      </main>
    </div>
  );
}
