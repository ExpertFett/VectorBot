import { addTrap, addBombScore, addSortie, getConfig } from '../db/index.js';
import { forwardSortie } from './readyroomBridge.js';

// Miss distance (m) -> grade band.
function bombGrade(d) {
  if (d <= 10) return 'Shack';
  if (d <= 25) return 'Excellent';
  if (d <= 50) return 'Good';
  if (d <= 100) return 'Fair';
  return 'Miss';
}

function fmtDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Map a DCS LSO grade comment to a label + points (heuristic; the raw comment
// format varies by DCS version/Supercarrier, so this is approximate and can be tuned).
export function gradePoints(comment) {
  const c = String(comment || '').toUpperCase();
  if (c.includes('WAVE') || c.includes('WAVEOFF') || /\bWO\b/.test(c)) return { label: 'Wave-off', points: 1 };
  if (c.includes('CUT')) return { label: 'Cut pass', points: 1 };
  if (c.includes('BOLTER')) return { label: 'Bolter', points: 2.5 };
  if (c.includes('NO GRADE') || c.includes('NOGRADE') || c.includes('---')) return { label: 'No grade', points: 2 };
  if (c.includes('FAIR') || c.includes('(OK)')) return { label: 'Fair', points: 3 };
  if (c.includes('_OK_') || c.includes('PERFECT')) return { label: 'OK (perfect)', points: 5 };
  if (c.includes('OK')) return { label: 'OK', points: 4 };
  return { label: comment ? String(comment).slice(0, 40) : 'Trap', points: 3 };
}

async function feed(client, guildId, text) {
  const cfg = getConfig(guildId);
  if (!cfg.dcs_feed_channel_id) return;
  const ch = client.channels.cache.get(cfg.dcs_feed_channel_id)
    || (await client.channels.fetch(cfg.dcs_feed_channel_id).catch(() => null));
  if (ch?.isTextBased()) ch.send(text.slice(0, 1900)).catch(() => {});
}

export async function handleDcsEvent(client, guildId, ev) {
  if (!ev || !ev.kind) return;

  if (ev.kind === 'kill') {
    const weapon = ev.weapon ? ` (${ev.weapon})` : '';
    await feed(client, guildId, `💥 **${ev.killer || 'Unknown'}** shot down **${ev.victim || 'Unknown'}**${weapon}`);
  } else if (ev.kind === 'trap' && ev.pilot) {
    const g = gradePoints(ev.grade);
    addTrap(guildId, { pilot: String(ev.pilot).slice(0, 80), grade: g.label, points: g.points, ship: ev.ship ? String(ev.ship).slice(0, 80) : null });
    await feed(client, guildId, `🪝 **${ev.pilot}** trapped${ev.ship ? ` aboard ${ev.ship}` : ''}: **${g.label}** (${g.points})`);
  } else if (ev.kind === 'bomb' && ev.shooter && typeof ev.distance === 'number') {
    // Only scored when a TGT marker was set (distance present).
    const d = Math.round(ev.distance * 10) / 10;
    const grade = bombGrade(d);
    addBombScore(guildId, { pilot: String(ev.shooter).slice(0, 80), weapon: ev.weapon ? String(ev.weapon).slice(0, 80) : null, distance: d, grade });
    await feed(client, guildId, `💣 **${ev.shooter}** — ${ev.weapon || 'ordnance'} — **${d} m** from target (**${grade}**)`);
  } else if (ev.kind === 'sortie' && ev.pilot) {
    const seconds = Math.max(0, Number(ev.seconds) || 0);
    addSortie(guildId, { pilot: String(ev.pilot).slice(0, 80), airframe: ev.airframe ? String(ev.airframe).slice(0, 80) : null, seconds });
    // Also fan out to ReadyRoom (no-op if neither per-guild config nor env URL is set).
    forwardSortie({ pilot: ev.pilot, airframe: ev.airframe, seconds }, guildId);
    await feed(client, guildId, `🛬 **${ev.pilot}** landed — ${fmtDuration(seconds)} sortie${ev.airframe ? ` in ${ev.airframe}` : ''}`);
  }
}
