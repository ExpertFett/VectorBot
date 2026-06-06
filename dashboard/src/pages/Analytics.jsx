import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Callout from '../components/Callout.jsx';

// Compact metric card with optional delta + sparkline.
function Metric({ label, value, sub, trend, accent = 'var(--accent)' }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
      {trend && <Sparkline series={trend} accent={accent} />}
    </div>
  );
}

// Tiny inline SVG sparkline. Series = [{day, count}, ...]. No deps.
function Sparkline({ series, accent = 'var(--accent)', height = 32 }) {
  if (!series?.length) return null;
  const w = 120;
  const h = height;
  const max = Math.max(1, ...series.map((p) => p.count));
  const stepX = w / Math.max(1, series.length - 1);
  const pts = series.map((p, i) => `${(i * stepX).toFixed(1)},${(h - (p.count / max) * (h - 4) - 2).toFixed(1)}`).join(' ');
  const lastY = h - ((series.at(-1)?.count || 0) / max) * (h - 4) - 2;
  return (
    <svg className="metric-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline fill="none" stroke={accent} strokeWidth="1.5" points={pts} />
      <circle cx={w} cy={lastY} r="2.5" fill={accent} />
    </svg>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {hint && <p className="muted" style={{ marginTop: 0 }}>{hint}</p>}
      <div className="metric-grid">{children}</div>
    </section>
  );
}

const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
const fmtPct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);
const fmtFlight = (h) => {
  if (!h || h < 1 / 60) return '0h';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
};
const fmtDelta = (n) => {
  if (n == null) return '';
  if (n === 0) return '±0';
  return n > 0 ? `+${n}` : `${n}`;
};

export default function Analytics() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.getAnalytics().then(setData).catch((e) => setStatus(e.body?.error || e.message));
  }, []);

  if (!data) {
    if (status === 'admin_only') return (
      <div className="page"><Callout type="warn">Analytics is admin-only — Manage Server required.</Callout></div>
    );
    return <div className="muted page">{status || 'Crunching numbers…'}</div>;
  }

  const { growth, events, dcs, applications, tickets, moderation, invites, generatedAt } = data;
  const ago = (() => {
    const s = Math.round((Date.now() - generatedAt) / 1000);
    return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
  })();

  return (
    <div className="page">
      <PageHeader title="Analytics" sub="Roll-up of activity, growth, and ops over the last 7 / 30 days. Computed from data the bot already tracks — no extra logging is enabled.">
        <span className="muted">Updated {ago}</span>
        <button className="link" onClick={() => { setData(null); api.getAnalytics().then(setData); }}>Refresh</button>
      </PageHeader>

      <Section title="Growth" hint="Welcome and goodbye log entries, last 30 days. Test sends from the dashboard are excluded.">
        <Metric label="Joins · 7d"  value={fmtInt(growth.joins.d7)}  sub={`${growth.joins.d30} in 30d`}  trend={growth.joinSeries}  accent="#22c55e" />
        <Metric label="Leaves · 7d" value={fmtInt(growth.leaves.d7)} sub={`${growth.leaves.d30} in 30d`} trend={growth.leaveSeries} accent="#e11d48" />
        <Metric label="Net · 7d"    value={fmtDelta(growth.net.d7)}  sub={`${fmtDelta(growth.net.d30)} in 30d`} />
      </Section>

      <Section title="Mission Events" hint="Last 30 days. Fill rate = sign-ups taken vs. capacity, only across capped events.">
        <Metric label="Posted · 30d" value={fmtInt(events.created30)} />
        <Metric label="Completed · 30d" value={fmtInt(events.completed30)} />
        <Metric label="Upcoming" value={fmtInt(events.upcoming)} sub="scheduled, future" />
        <Metric label="Fill rate"  value={fmtPct(events.fillRate)}
          sub={events.eventsWithCap30 ? `${events.eventsWithCap30} capped event${events.eventsWithCap30 === 1 ? '' : 's'} sampled` : 'no capped events yet'} />
      </Section>

      <Section title="DCS Ops · last 7 days" hint="From the ingest pipe — sortie logs, carrier traps, bomb-range scores.">
        <Metric label="Sorties"      value={fmtInt(dcs.sorties7)} sub={`${fmtFlight(dcs.sortieHours7)} total flight time`} />
        <Metric label="Carrier traps" value={fmtInt(dcs.traps7)}   sub={dcs.trapAvg7 ? `avg ${dcs.trapAvg7.toFixed(1)} pts` : 'no traps yet'} />
        <Metric label="Bomb hits"    value={fmtInt(dcs.bombs7)}   sub={dcs.bombAvgMeters7 ? `avg ${dcs.bombAvgMeters7.toFixed(1)} m off target` : 'no scores yet'} />
      </Section>

      <Section title="Applications" hint="Recruitment funnel for the last 30 days.">
        <Metric label="Submitted · 30d" value={fmtInt(applications.total30)} />
        <Metric label="Pending"  value={fmtInt(applications.pending)}  sub={applications.pending > 0 ? 'awaiting review' : 'inbox clear'} />
        <Metric label="Approved · 30d" value={fmtInt(applications.approved30)} sub={applications.approvalRate != null ? `${fmtPct(applications.approvalRate)} approval rate` : null} />
        <Metric label="Rejected · 30d" value={fmtInt(applications.rejected30)} />
      </Section>

      <Section title="Tickets" hint="Support ticket throughput.">
        <Metric label="Open now"      value={fmtInt(tickets.openNow)} />
        <Metric label="Opened · 30d"  value={fmtInt(tickets.opened30)} />
        <Metric label="Closed · 30d"  value={fmtInt(tickets.closed30)} />
      </Section>

      <Section title="Moderation" hint="Mod-log entries the bot recorded — warns, kicks, bans, mutes, /purge etc.">
        <Metric label="Actions · 30d" value={fmtInt(moderation.actions30)}
          sub={moderation.breakdown.length ? moderation.breakdown.slice(0, 3).map((b) => `${b.action}: ${b.n}`).join(' · ') : 'no actions'} />
      </Section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Top inviters</h2>
        {invites.topInviters.length === 0 ? (
          <p className="muted">No tracked invites yet. Members joining via invite links will appear here once they do.</p>
        ) : (
          <ol className="top-list">
            {invites.topInviters.map((r) => (
              <li key={r.inviter_id}><span>&lt;@{r.inviter_id}&gt;</span><b>{r.joins}</b></li>
            ))}
          </ol>
        )}
        <p className="muted" style={{ fontSize: '0.82rem' }}>Full leaderboard + management on the <Link className="link" to="/invites">Invite Tracker</Link> page.</p>
      </section>

      <Callout type="tip">
        Want a metric that isn't here? Tell me what — most things are one SQL query away since we already track the underlying data.
      </Callout>
    </div>
  );
}
