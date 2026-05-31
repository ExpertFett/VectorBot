import { api } from '../api.js';
import Brand from '../components/Brand.jsx';

// Official Discord logo glyph — same shape used on the DCS:OPT Planner button.
const DiscordMark = () => (
  <svg viewBox="0 0 71 55" aria-hidden="true">
    <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2814 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2786 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z"/>
  </svg>
);

const FEATURES = [
  { title: 'Mission Scheduling', text: 'Post events with sign-up sheets parsed straight from your .miz — slots, flights and seats fill themselves. Reminders, waitlists and multi-crew included.' },
  { title: 'Live Server Status', text: 'A self-updating embed shows your DCS server name, mission, player count and uptime — fed by a lightweight in-game hook.' },
  { title: 'Scores & Leaderboards', text: 'Carrier trap grades, bomb-on-target accuracy, a kill feed and sortie hours — tracked automatically and ranked.' },
  { title: 'Squadron Roster & Quals', text: 'Track callsigns, airframes and qualifications. Import your whole roster from a spreadsheet in seconds.' },
  { title: 'Recruitment & Onboarding', text: 'Custom application forms with staff approve/deny, plus a guided welcome tour that walks new members through roles and rules.' },
  { title: 'Moderation & Automod', text: 'Bans, kicks, timeouts, warnings and a filtered bulk-purge, plus automatic spam / link / word filtering — all logged.' },
  { title: 'Roles & Engagement', text: 'Reaction, button and dropdown role menus, a verification gate, giveaways, sticky messages, scheduled posts and reminders.' },
  { title: 'Social Alerts', text: 'Auto-post when you go live or upload — YouTube, Twitch, Kick, Reddit and any RSS feed.' },
  { title: 'Flight-Sim Toolbox', text: '/coords, /braa, /bullseye, /metar and /taf — coordinate conversion and real-world weather, right in chat.' },
];

const STEPS = [
  { n: '1', title: 'Invite the bot', text: 'Add DCS:OPT to your Discord with one click and the right permissions.' },
  { n: '2', title: 'Log in here', text: 'Sign in with Discord, choose your server, and you land in the control panel.' },
  { n: '3', title: 'Configure from the web', text: 'Set up every feature from this dashboard — nothing to memorise. Optionally link your DCS server for live stats.' },
];

const INTEGRATIONS = [
  { title: 'DCS World', text: 'A drop-in GameGUI Lua hook streams live server status, kills, carrier traps, bomb scores and sortie time. Mission .miz files are parsed into ready-made sign-up sheets.' },
  { title: 'Discord', text: 'A full-featured bot — roles, moderation, tickets, events, embeds and more — multi-server out of the box and driven entirely from this dashboard.' },
  { title: 'Streaming & Social', text: 'YouTube, Twitch, Kick, Reddit and RSS notifications keep your community in the loop the moment something drops.' },
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
      <section className="landing-hero">
        <Brand variant="hero" />
        <h1>The all-in-one command center for your DCS community</h1>
        <p className="hero-sub">
          DCS:OPT is a Discord bot built for flight-sim squadrons — mission scheduling, live server stats,
          scoreboards, roster management, recruitment and full server moderation, all controlled from one web dashboard.
        </p>
        <a className="btn-discord" href="/auth/login"><DiscordMark /> Log in with Discord</a>
        {error && <p className="error">Login error: {error.replace(/_/g, ' ')}</p>}
        <p className="hero-note">Free to add · You’ll need <b>Manage Server</b> on the Discord you want to set up.</p>
      </section>

      <section className="landing-section">
        <h2 className="section-title">What it does</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
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
              <h3>{i.title}</h3>
              <p>{i.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h2>Ready to run your squadron from one place?</h2>
        <a className="btn-discord" href="/auth/login"><DiscordMark /> Log in with Discord</a>
      </section>

      <footer className="landing-footer">
        <Brand variant="sm" />
        <span className="muted">DCS:OPT — Operational Planning Tool · Not affiliated with Eagle Dynamics.</span>
      </footer>
    </div>
  );
}
