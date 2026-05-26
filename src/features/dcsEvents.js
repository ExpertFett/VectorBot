import { addTrap, getConfig } from '../db/index.js';

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
  }
}
