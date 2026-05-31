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
import Traps from './pages/Traps.jsx';
import Bombs from './pages/Bombs.jsx';
import Sorties from './pages/Sorties.jsx';
import Roster from './pages/Roster.jsx';
import Recruitment from './pages/Recruitment.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Brand from './components/Brand.jsx';
import DiscordButton from './components/DiscordButton.jsx';

// Sidebar navigation grouped into sections. [path, icon, label]
const NAV = [
  { label: 'DCS Operations', links: [
    ['/events', '🗓️', 'Mission Events'],
    ['/dcs', '📡', 'DCS Server'],
    ['/traps', '⚓', 'Carrier Traps'],
    ['/bombs', '🎯', 'Bomb Range'],
    ['/sorties', '✈️', 'Sortie Log'],
  ] },
  { label: 'Squadron', links: [
    ['/roster', '🎖️', 'Roster'],
    ['/recruitment', '📋', 'Recruitment'],
  ] },
  { label: 'Members & Roles', links: [
    ['/welcome', '👋', 'Welcome & Roles'],
    ['/onboarding', '🚪', 'Onboarding'],
    ['/verification', '✅', 'Verification'],
    ['/rolemenus', '🎭', 'Reaction Roles'],
  ] },
  { label: 'Engagement', links: [
    ['/commands', '⌨️', 'Custom Commands'],
    ['/scheduled', '⏰', 'Scheduled Messages'],
    ['/sticky', '📌', 'Sticky Messages'],
    ['/embed', '📤', 'Send Embed'],
    ['/tickets', '🎫', 'Tickets'],
    ['/giveaways', '🎉', 'Giveaways'],
    ['/social', '🔔', 'Social Alerts'],
  ] },
  { label: 'Moderation', links: [
    ['/automod', '🛡️', 'Auto-moderation'],
    ['/moderation', '🔨', 'Moderation'],
  ] },
  { label: 'Server', links: [
    ['/stats', '📊', 'Stats Channels'],
    ['/invites', '🎟️', 'Invite Tracker'],
    ['/personalizer', '🎨', 'Personalizer'],
  ] },
];

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
  if (!user) return (<><Login /><DiscordButton /></>);

  if (!user.selectedGuildId || picking) {
    return (
      <>
        <ServerPicker
          onSelected={() => { setPicking(false); setLoading(true); refresh(); }}
          onCancel={user.selectedGuildId ? () => setPicking(false) : null}
        />
        <DiscordButton />
      </>
    );
  }

  const logout = async () => { try { await api.logout(); } catch { /* ignore */ } setUser(null); };

  return (
    <div className="app">
      <aside className="sidebar">
        <Brand variant="sm" />
        <button className="server-switch" onClick={() => setPicking(true)} title="Switch server">
          {guild?.icon && <img src={guild.icon} alt="" />}
          <span>{guild?.name || 'Server'}</span>
          <span className="switch-icon">⇄</span>
        </button>
        <nav>
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.links.map(([to, icon, label]) => (
                <NavLink key={to} to={to}>
                  <span className="nav-icon" aria-hidden="true">{icon}</span>
                  <span className="nav-label">{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
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
          <Route path="/roster" element={<Roster />} />
          <Route path="/recruitment" element={<Recruitment />} />
          <Route path="/dcs" element={<DCSServer />} />
          <Route path="/traps" element={<Traps />} />
          <Route path="/bombs" element={<Bombs />} />
          <Route path="/sorties" element={<Sorties />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/onboarding" element={<Onboarding />} />
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
      <DiscordButton />
    </div>
  );
}
