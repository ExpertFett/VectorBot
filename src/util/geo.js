import mgrs from 'mgrs';

// Parse "lat, lon" decimal, or a DMS-ish string, into { lat, lon } (decimal). Returns null on failure.
export function parseLatLon(str) {
  if (!str) return null;
  const s = String(str).trim();
  // Decimal "37.5, -115.2" or "37.5 -115.2"
  const dec = s.match(/^(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)$/);
  if (dec) {
    const lat = parseFloat(dec[1]); const lon = parseFloat(dec[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  // DMS like 37°30'00"N 115°12'00"W
  const dms = s.match(/(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([NSEW])/gi);
  if (dms && dms.length === 2) {
    const conv = (m) => {
      const p = m.match(/(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([NSEW])/i);
      let v = parseInt(p[1], 10) + parseInt(p[2], 10) / 60 + parseFloat(p[3]) / 3600;
      if (/[SW]/i.test(p[4])) v = -v;
      return { v, dir: p[4].toUpperCase() };
    };
    const a = conv(dms[0]); const b = conv(dms[1]);
    const lat = /[NS]/i.test(a.dir) ? a.v : b.v;
    const lon = /[EW]/i.test(a.dir) ? a.v : b.v;
    return { lat, lon };
  }
  return null;
}

const toDMSPart = (val, posDir, negDir) => {
  const dir = val >= 0 ? posDir : negDir;
  const abs = Math.abs(val);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const sec = ((abs - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}'${sec.toFixed(1)}"${dir}`;
};

export function toDMS({ lat, lon }) {
  return `${toDMSPart(lat, 'N', 'S')} ${toDMSPart(lon, 'E', 'W')}`;
}

export function toMGRS({ lat, lon }) {
  try { return mgrs.forward([lon, lat]); } catch { return null; }
}

export function mgrsToLatLon(str) {
  try { const [lon, lat] = mgrs.toPoint(String(str).replace(/\s+/g, '').toUpperCase()); return { lat, lon }; }
  catch { return null; }
}

// Great-circle bearing (true, deg) + distance from A to B.
export function bearingRange(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(a.lat); const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const brg = (toDeg(Math.atan2(y, x)) + 360) % 360;
  const R = 6371000; // m
  const Δφ = φ2 - φ1;
  const aa = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return { bearing: Math.round(brg), nm: dist / 1852, km: dist / 1000 };
}
