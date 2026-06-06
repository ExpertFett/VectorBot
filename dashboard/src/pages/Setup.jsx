import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

// Permissions the bot needs in Server Settings → Roles. The default invite
// link already includes the common ones; others only matter for specific
// features (called out so admins know which to add when something fails).
const PERMISSIONS = [
  ['Send Messages, Embed Links, Attach Files, Read Message History', 'Bare minimum — posting panels, embeds, stickies and command replies.'],
  ['Manage Roles', 'Required to grant the verified, onboarding, recruitment-approved and auto-roles. Bot’s role must sit ABOVE any role it grants.'],
  ['Manage Channels', 'Needed by Tickets (creates a private channel per ticket) and Stats Channels (creates / renames counter channels).'],
  ['Manage Messages', 'Lets /purge bulk-delete and the bot tidy sticky messages.'],
  ['Manage Server', 'Required by the Invite Tracker (reads server invites to attribute joins).'],
  ['Kick / Ban / Moderate Members', 'Needed for /kick, /ban, /timeout if you’ll use them.'],
];

// Suggested channel layout — pure recommendation, you can wire any feature
// to any channel later.
const CHANNELS = [
  ['#welcome', 'Greet new joiners. Verification panel can live here too.'],
  ['#rules', 'Server rules. Drop the Onboarding panel here.'],
  ['#announcements', 'Scheduled posts, server-wide updates.'],
  ['#general', 'Day-to-day chat. Custom commands fire here.'],
  ['#tickets', 'Public panel — members click to open a private support ticket.'],
  ['🎫 Tickets (category)', 'Holds the private ticket channels the bot creates.'],
  ['#staff-log', 'Moderation actions, mod log, recruitment reviews — staff-only.'],
  ['#ops-schedule', 'Mission Events sign-up sheets.'],
  ['#dcs-server', 'Live DCS server status embed (auto-updates).'],
  ['#kill-feed', 'In-mission events: kills, traps, bomb drops, sorties.'],
  ['#recruiting', 'Public recruitment panel — members apply here.'],
  ['#social', 'YouTube / Twitch / Kick / Reddit alerts.'],
];

// Suggested role structure.
const ROLES = [
  ['Member', 'Granted on Verification — gates access to the main channels.'],
  ['Applicant', 'Default for new joiners while they go through onboarding / vetting.'],
  ['Staff', 'Reviews recruitment applications, claims tickets, runs moderation.'],
  ['Support', 'Can see and claim tickets.'],
  ['Pilot / airframe roles', 'Self-assigned via Reaction Roles or granted by Onboarding completion.'],
];

// Setup priority — what to configure first, with links to the relevant tabs.
const STEPS = [
  {
    title: 'Customize the bot',
    body: 'Set the bot’s nickname for this server and the accent color used on every embed it sends.',
    pages: [['Customize', '/personalizer']],
  },
  {
    title: 'Stand up the welcome flow',
    body: 'Pick where new members are greeted, an auto-role on join (optional), and stand up the guided onboarding tour for first-time visitors.',
    pages: [['Welcome & Roles', '/welcome'], ['Onboarding', '/onboarding']],
  },
  {
    title: 'Add a verification gate',
    body: 'Post a one-click verify button in a public channel and have the bot grant your Member role. Channel permissions do the rest.',
    pages: [['Verification', '/verification']],
  },
  {
    title: 'Set up moderation',
    body: 'Pick a log channel for mod actions and turn on auto-moderation rules (spam, mass-mentions, invites, links, word filters).',
    pages: [['Auto-moderation', '/automod'], ['Moderation', '/moderation']],
  },
  {
    title: 'Open support tickets',
    body: 'Choose a panel channel, a ticket category, and a Support role. The bot posts an "Open Ticket" button that creates a private channel each time.',
    pages: [['Tickets', '/tickets']],
  },
  {
    title: 'Build your squadron roster + recruitment',
    body: 'Enter callsigns / airframes / quals (CSV import works), then post the recruitment application panel and a review channel for staff.',
    pages: [['Roster', '/roster'], ['Recruitment', '/recruitment']],
  },
  {
    title: 'Schedule your first mission',
    body: 'Create an event, import slots straight from your .miz, pick a channel, and (optionally) set Repeat for a weekly ops board.',
    pages: [['Mission Events', '/events']],
  },
  {
    title: 'Connect your DCS server',
    body: 'Drop the included Lua hook into your DCS server PC and paste the ingest URL. Live status, kill feed, carrier traps, bomb scoring and sortie logging start flowing automatically.',
    pages: [['DCS Server', '/dcs']],
  },
  {
    title: 'Light up community features',
    body: 'Add self-assign role menus, scheduled / sticky messages, giveaways, social-platform alerts, stats counter channels and invite tracking as your community needs them.',
    pages: [
      ['Reaction Roles', '/rolemenus'],
      ['Scheduled Messages', '/scheduled'],
      ['Sticky Messages', '/sticky'],
      ['Giveaways', '/giveaways'],
      ['Social Alerts', '/social'],
      ['Stats Channels', '/stats'],
      ['Invite Tracker', '/invites'],
      ['Send Embed', '/embed'],
      ['Custom Commands', '/commands'],
    ],
  },
];

export default function Setup() {
  const nav = useNavigate();
  return (
    <div className="page">
      <PageHeader title="Getting Started"
        sub="New to the bot? Here’s everything you’ll want set up on your Discord, in the order I’d do it.">
        <button className="btn" onClick={() => nav('/wizard')}>🧭 Run setup wizard</button>
      </PageHeader>

      <Callout type="tip">
        <b>First time here?</b> Hit <b>Run setup wizard</b> above — it walks through the essentials (nickname / accent color, welcome message, auto-role, verification gate) in 3-5 minutes. You can always come back to this page for the full feature-by-feature reference.
      </Callout>

      <section className="card">
        <h2>1. Bot permissions</h2>
        <p className="muted">Set in <b>Server Settings → Roles → DCS:OPT</b>. The default invite link already includes the common ones; the rest only matter for the specific features called out below.</p>
        <ul className="setup-list">
          {PERMISSIONS.map(([name, why]) => (
            <li key={name}><b>{name}</b><span className="muted"> — {why}</span></li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>2. Recommended channels</h2>
        <p className="muted">A sensible starting layout for a DCS community server. You can wire any feature to any channel later — these are just useful defaults to create up-front.</p>
        <ul className="setup-list">
          {CHANNELS.map(([name, why]) => (
            <li key={name}><code>{name}</code><span className="muted"> — {why}</span></li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>3. Recommended roles</h2>
        <p className="muted">Create these in <b>Server Settings → Roles</b>. Make sure the bot’s own role sits <b>above</b> every role it needs to grant — Discord won’t let it touch anything ranked higher than itself.</p>
        <ul className="setup-list">
          {ROLES.map(([name, why]) => (
            <li key={name}><b>{name}</b><span className="muted"> — {why}</span></li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>4. Step-by-step setup</h2>
        <p className="muted">Work through these in order. Each step takes a few minutes and links to the tab where you configure it.</p>
        <ol className="setup-steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <b>{s.title}</b>
              <p className="muted">{s.body}</p>
              {s.pages.length > 0 && (
                <div className="setup-links">
                  {s.pages.map(([label, href]) => (
                    <Link key={href} className="link" to={href}>{label} →</Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <Callout>
        Once you’ve walked through the steps, just pick a tab from the sidebar whenever you want to tweak something. Errors in production are DM’d to you automatically, and the DB is backed up daily — so if anything looks wrong, give the deploy a minute and try again before worrying.
      </Callout>
    </div>
  );
}
