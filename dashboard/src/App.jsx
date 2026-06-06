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
import WelcomeChannelPage from './pages/WelcomeChannelPage.jsx';
import AccessGroups from './pages/AccessGroups.jsx';
import Analytics from './pages/Analytics.jsx';
import AutomationsPage from './pages/Automations.jsx';
import Setup from './pages/Setup.jsx';
import SetupWizard from './pages/SetupWizard.jsx';
import Brand from './components/Brand.jsx';
import DiscordButton from './components/DiscordButton.jsx';

// Sidebar navigation grouped into sections. Each link:
//   [path, icon, label, requiredAction?]
// If requiredAction is set, the tab only appears when the current user has
// that permission. 'admin' means admins-only (Manage Server). Tabs without a
// flag are always visible.
const NAV = [
  { label: 'Start Here', links: [
    ['/wizard', '🧭', 'Setup Wizard'],
    ['/setup', '🚀', 'Setup Guide'],
    ['/personalizer', '🎨', 'Customize', 'personalizer.manage'],
  ] },
  { label: 'DCS Operations', links: [
    ['/events', '🗓️', 'Mission Events', 'events.manage'],
    ['/dcs', '📡', 'DCS Server'],
    ['/traps', '⚓', 'Carrier Traps'],
    ['/bombs', '🎯', 'Bomb Range'],
    ['/sorties', '✈️', 'Sortie Log'],
  ] },
  { label: 'Squadron', links: [
    ['/roster', '🎖️', 'Roster', 'roster.manage'],
    ['/recruitment', '📋', 'Recruitment', 'recruitment.manage'],
  ] },
  { label: 'Members & Roles', links: [
    ['/welcome', '👋', 'Welcome & Roles', 'welcome.manage'],
    ['/welcome-channel', '📜', 'Welcome Channel', 'welcomepage.manage'],
    ['/onboarding', '🚪', 'Onboarding', 'onboarding.manage'],
    ['/verification', '✅', 'Verification', 'verification.manage'],
    ['/rolemenus', '🎭', 'Reaction Roles', 'rolemenus.manage'],
  ] },
  { label: 'Engagement', links: [
    ['/commands', '⌨️', 'Custom Commands', 'admin'],
    ['/scheduled', '⏰', 'Scheduled Messages', 'scheduled.create'],
    ['/sticky', '📌', 'Sticky Messages', 'sticky.set'],
    ['/embed', '📤', 'Send Embed', 'announcements.send'],
    ['/tickets', '🎫', 'Tickets', 'tickets.manage'],
    ['/giveaways', '🎉', 'Giveaways', 'giveaways.create'],
    ['/social', '🔔', 'Social Alerts', 'admin'],
  ] },
  { label: 'Moderation', links: [
    ['/automod', '🛡️', 'Auto-moderation', 'automod.manage'],
    ['/moderation', '🔨', 'Moderation', 'admin'],
  ] },
  { label: 'Server', links: [
    ['/analytics', '📈', 'Analytics', 'admin'],
    ['/automations', '⚡', 'Automations', 'admin'],
    ['/access', '🛂', 'Access Groups', 'admin'],
    ['/stats', '📊', 'Stats Channels', 'admin'],
    ['/invites', '🎟️', 'Invite Tracker'],
  ] },
];

// Decide whether a link is visible to the current user.
function linkVisible(req, user) {
  if (!req) return true; // public tab
  if (req === 'admin') return !!(user?.access?.isAdmin || user?.access?.isOwner);
  // Action gate. If we haven't received a permissions map yet (no guild
  // selected), show all tabs — they'd be no-ops until guild-select anyway.
  if (!user?.permissions) return true;
  return !!user.permissions[req];
}

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
          {NAV.map((group) => {
            const links = group.links.filter(([, , , req]) => linkVisible(req, user));
            if (!links.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-group-label">{group.label}</div>
                {links.map(([to, icon, label]) => (
                  <NavLink key={to} to={to}>
                    <span className="nav-icon" aria-hidden="true">{icon}</span>
                    <span className="nav-label">{label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="user">
          {user.avatar && <img src={user.avatar} alt="" />}
          <span className="uname">{user.username}</span>
          <button className="link" onClick={logout}>Logout</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/wizard" element={<SetupWizard />} />
          <Route path="/events" element={<Events />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/recruitment" element={<Recruitment />} />
          <Route path="/dcs" element={<DCSServer />} />
          <Route path="/traps" element={<Traps />} />
          <Route path="/bombs" element={<Bombs />} />
          <Route path="/sorties" element={<Sorties />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/welcome-channel" element={<WelcomeChannelPage />} />
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
          <Route path="/access" element={<AccessGroups />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/personalizer" element={<Personalizer />} />
          <Route path="*" element={<Navigate to="/wizard" replace />} />
        </Routes>
      </main>
      <DiscordButton />
    </div>
  );
}
