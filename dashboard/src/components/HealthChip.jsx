import { useEffect, useState } from 'react';
import { api } from '../api.js';

// At-a-glance bot health, shown in the sidebar. Polls /api/health every 30s.
//   green  = connected (gateway Ready)
//   amber  = reachable but gateway not Ready (reconnecting / zombie forming)
//   red    = the request failed → process likely down / restarting
// Lets you see "is the bot actually alive" without digging through Railway.

const fmtUptime = (ms) => {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
};

export default function HealthChip() {
  const [h, setH] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try { const d = await api.health(); if (!stop) { setH(d); setFailed(false); } }
      catch { if (!stop) setFailed(true); }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  let color = '#6b7280', label = 'Checking…', detail = '';
  if (failed) { color = '#e11d48'; label = 'Bot unreachable'; detail = 'process may be restarting'; }
  else if (h) {
    if (h.ready && h.ws_status === 0) {
      color = '#22c55e'; label = 'Bot online';
      detail = `up ${fmtUptime(h.uptime_ms)}${h.ping_ms != null ? ` · ${h.ping_ms}ms` : ''}`;
    } else {
      color = '#f0b429'; label = 'Reconnecting…'; detail = `gateway status ${h.ws_status ?? '?'}`;
    }
  }

  return (
    <div className="health-chip" title={h?.ready_at ? `Last connected: ${new Date(h.ready_at).toLocaleString()}` : ''}>
      <span className="health-dot" style={{ background: color, boxShadow: color === '#22c55e' ? `0 0 6px ${color}` : 'none' }} />
      <span className="health-text">
        <b>{label}</b>
        {detail && <span className="health-detail"> · {detail}</span>}
      </span>
    </div>
  );
}
