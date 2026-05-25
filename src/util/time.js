// Parse a human duration like "10m", "2h", "1d", "1h30m", "30s" into milliseconds.
// Returns null if nothing parses.
const UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };

export function parseDuration(str) {
  if (!str) return null;
  const re = /(\d+)\s*(s|m|h|d|w)/gi;
  let ms = 0;
  let matched = false;
  let m;
  while ((m = re.exec(str)) !== null) {
    matched = true;
    ms += parseInt(m[1], 10) * UNIT_MS[m[2].toLowerCase()];
  }
  return matched ? ms : null;
}
