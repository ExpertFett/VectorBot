import { api } from '../api.js';
import Brand from '../components/Brand.jsx';

const FEATURES = [
  { icon: '🗓️', title: 'Mission Scheduling', text: 'Post events with sign-up sheets parsed straight from your .miz — slots, flights and seats fill themselves. Reminders, waitlists and multi-crew included.' },
  { icon: '📡', title: 'Live Server Status', text: 'A self-updating embed shows your DCS server name, mission, player count and uptime — fed by a lightweight in-game hook.' },
  { icon: '🎯', title: 'Scores & Leaderboards', text: 'Carrier trap grades, bomb-on-target accuracy, a kill feed and sortie hours — tracked automatically and ranked.' },
  { icon: '🧑‍✈️', title: 'Squadron Roster & Quals', text: 'Track callsigns, airframes and qualifications. Import your whole roster from a spreadsheet in seconds.' },
  { icon: '📝', title: 'Recruitment & Onboarding', text: 'Custom application forms with staff approve/deny, plus a guided welcome tour that walks new members through roles and rules.' },
  { icon: '🛡️', title: 'Moderation & Automod', text: 'Bans, kicks, timeouts, warnings and a filtered bulk-purge, plus automatic spam / link / word filtering — all logged.' },
  { icon: '🎭', title: 'Roles & Engagement', text: 'Reaction, button and dropdown role menus, a verification gate, giveaways, sticky messages, scheduled posts and reminders.' },
  { icon: '🔔', title: 'Social Alerts', text: 'Auto-post when you go live or upload — YouTube, Twitch, Kick, Reddit and any RSS feed.' },
  { icon: '🧰', title: 'Flight-Sim Toolbox', text: '/coords, /braa, /bullseye, /metar and /taf — coordinate conversion and real-world weather, right in chat.' },
];

const STEPS = [
  { n: '1', title: 'Invite the bot', text: 'Add DCS:OPT to your Discord with one click and the right permissions.' },
  { n: '2', title: 'Log in here', text: 'Sign in with Discord, choose your server, and you land in the control panel.' },
  { n: '3', title: 'Configure from the web', text: 'Set up every feature from this dashboard — nothing to memorise. Optionally link your DCS server for live stats.' },
];

const INTEGRATIONS = [
  { icon: '✈️', title: 'DCS World', text: 'A drop-in GameGUI Lua hook streams live server status, kills, carrier traps, bomb scores and sortie time. Mission .miz files are parsed into ready-made sign-up sheets.' },
  { icon: '💬', title: 'Discord', text: 'A full-featured bot — roles, moderation, tickets, events, embeds and more — multi-server out of the box and driven entirely from this dashboard.' },
  { icon: '📺', title: 'Streaming & Social', text: 'YouTube, Twitch, Kick, Reddit and RSS notifications keep your community in the loop the moment something drops.' },
];

export default function Login({ noAccess, user }) {
  const error = new URLSearchParams(window.location.search).get('error');

  const switchAccount = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    window.location.href = '/auth/login';
  };

  // Logged in but lacking Manage Server on the selected guild — keep the simple card.
  if (noAccess) {
    return (
      <div className="center">
        <div className="login-card">
          <Brand variant="lg" />
          <p className="muted">
            Signed in as <b>{user?.username}</b>, but you don’t have <b>Manage Server</b> permission on this server.
          </p>
          <button className="btn" onClick={switchAccount}>Switch account</button>
        </div>
      </div>
    );
  }

  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand variant="sm" />
        <a className="btn discord" href="/auth/login">Login with Discord</a>
      </header>

      <section className="landing-hero">
        <Brand variant="hero" />
        <h1>The all-in-one command center for your DCS community</h1>
        <p className="hero-sub">
          DCS:OPT is a Discord bot built for flight-sim squadrons — mission scheduling, live server stats,
          scoreboards, roster management, recruitment and full server moderation, all controlled from one web dashboard.
        </p>
        <a className="btn discord hero-cta" href="/auth/login">Login with Discord</a>
        {error && <p className="error">Login error: {error.replace(/_/g, ' ')}</p>}
        <p className="hero-note">Free to add · You’ll need <b>Manage Server</b> on the Discord you want to set up.</p>
      </section>

      <section className="landing-section">
        <h2 className="section-title">What it does</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2 className="section-title">How it works</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2 className="section-title">Integrations</h2>
        <div className="integrations">
          {INTEGRATIONS.map((i) => (
            <div className="integration" key={i.title}>
              <div className="integration-icon">{i.icon}</div>
              <div>
                <h3>{i.title}</h3>
                <p>{i.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h2>Ready to run your squadron from one place?</h2>
        <a className="btn discord hero-cta" href="/auth/login">Login with Discord</a>
      </section>

      <footer className="landing-footer">
        <Brand variant="sm" />
        <span className="muted">DCS:OPT — Operational Planning Tool · Not affiliated with Eagle Dynamics.</span>
      </footer>
    </div>
  );
}
