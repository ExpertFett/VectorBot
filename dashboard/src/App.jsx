import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import ServerPicker from './pages/ServerPicker.jsx';
import Welcome from './pages/Welcome.jsx';
import Commands from './pages/Commands.jsx';
import Automod from './pages/Automod.jsx';
import RoleMenus from './pages/RoleMenus.jsx';
import Moderation from './pages/Moderation.jsx';
import Verification from './pages/Verification.jsx';
import ScheduledMessages from './pages/ScheduledMessages.jsx';
import Sticky from './pages/Sticky.jsx';
import Tickets from './pages/Tickets.jsx';
import Giveaways from './pages/Giveaways.jsx';
import Social from './pages/Social.jsx';
import Stats from './pages/Stats.jsx';
import EmbedPanel from './pages/EmbedPanel.jsx';
import Invites from './pages/Invites.jsx';
import Personalizer from './pages/Personalizer.jsx';
import Events from './pages/Events.jsx';
import DCSServer from './pages/DCSServer.jsx';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [guild, setGuild] = useState(null);
  const [picking, setPicking] = useState(false);

  const refresh = () =>
    api.me()
      .then((u) => {
        setUser(u);
        if (u?.selectedGuildId) api.guild().then(setGuild).catch(() => setGuild(null));
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

  useEffect(() => { refresh(); }, []);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Login />;

  if (!user.selectedGuildId || picking) {
    return (
      <ServerPicker
        onSelected={() => { setPicking(false); setLoading(true); refresh(); }}
        onCancel={user.selectedGuildId ? () => setPicking(false) : null}
      />
    );
  }

  const logout = async () => { try { await api.logout(); } catch { /* ignore */ } setUser(null); };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Vector<span>Bot</span></div>
        <button className="server-switch" onClick={() => setPicking(true)} title="Switch server">
          {guild?.icon && <img src={guild.icon} alt="" />}
          <span>{guild?.name || 'Server'}</span>
          <span className="switch-icon">⇄</span>
        </button>
        <nav>
          <NavLink to="/events">Mission Events</NavLink>
          <NavLink to="/dcs">DCS Server</NavLink>
          <NavLink to="/welcome">Welcome &amp; Roles</NavLink>
          <NavLink to="/verification">Verification</NavLink>
          <NavLink to="/commands">Custom Commands</NavLink>
          <NavLink to="/automod">Auto-moderation</NavLink>
          <NavLink to="/rolemenus">Reaction Roles</NavLink>
          <NavLink to="/scheduled">Scheduled Messages</NavLink>
          <NavLink to="/sticky">Sticky Messages</NavLink>
          <NavLink to="/embed">Send Embed</NavLink>
          <NavLink to="/tickets">Tickets</NavLink>
          <NavLink to="/giveaways">Giveaways</NavLink>
          <NavLink to="/social">Social Alerts</NavLink>
          <NavLink to="/stats">Stats Channels</NavLink>
          <NavLink to="/invites">Invite Tracker</NavLink>
          <NavLink to="/moderation">Moderation</NavLink>
          <NavLink to="/personalizer">Personalizer</NavLink>
        </nav>
        <div className="user">
          {user.avatar && <img src={user.avatar} alt="" />}
          <span className="uname">{user.username}</span>
          <button className="link" onClick={logout}>Logout</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/events" element={<Events />} />
          <Route path="/dcs" element={<DCSServer />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/verification" element={<Verification />} />
          <Route path="/commands" element={<Commands />} />
          <Route path="/automod" element={<Automod />} />
          <Route path="/rolemenus" element={<RoleMenus />} />
          <Route path="/scheduled" element={<ScheduledMessages />} />
          <Route path="/sticky" element={<Sticky />} />
          <Route path="/embed" element={<EmbedPanel />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/giveaways" element={<Giveaways />} />
          <Route path="/social" element={<Social />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/invites" element={<Invites />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/personalizer" element={<Personalizer />} />
          <Route path="*" element={<Navigate to="/welcome" replace />} />
        </Routes>
      </main>
    </div>
  );
}
