import * as THREE from 'three';
import { API } from './constants.js';

// Daylight from the viewer's local time: dark until ~05:30, full day 08:30–17:00,
// dusk until ~20:00. Mapped back onto applyDayFactor's phase (0 = noon).
// The city's clock: 'auto' day/night follows the developer's local time when
// we know it: city.json look.timezone (IANA), else the UTC offset of their
// latest commit (a commit patch keeps its author's "Date: ... +0200"), else
// the viewer's own clock.
export const devTz = { offset: null }; // minutes east of UTC; app.js fills it in per profile
// Where city.json's look.timezone comes from (app.js: the config on screen).
let zoneOf = () => null;
export function setTimezoneSource(fn) { zoneOf = fn; }
export function devLocalTime(now = new Date()) {
  const zone = zoneOf();
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
      const get = (t) => Number(parts.find(p => p.type === t)?.value);
      return { h: get('hour') + get('minute') / 60, label: zone.split('/').pop().replace(/_/g, ' ') };
    } catch { /* not a zone this browser knows: fall through */ }
  }
  if (devTz.offset != null) {
    const mins = (((now.getUTCHours() * 60 + now.getUTCMinutes() + devTz.offset) % 1440) + 1440) % 1440;
    const a = Math.abs(devTz.offset), mm = a % 60;
    return { h: mins / 60, label: `UTC${devTz.offset < 0 ? '−' : '+'}${Math.floor(a / 60)}${mm ? `:${String(mm).padStart(2, '0')}` : ''}` };
  }
  return { h: now.getHours() + now.getMinutes() / 60, label: 'your clock' };
}
export function updateDevClock() {
  const el = document.getElementById('dev-time');
  if (!el) return;
  const { h, label } = devLocalTime();
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  el.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${label}`;
}
setInterval(updateDevClock, 30000);
const TZ_CACHE = 'gc-tz:';
export async function detectDevOffset(login, events) {
  const key = TZ_CACHE + String(login).toLowerCase();
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 7 * 864e5) return c.offset; } catch { /* no storage */ }
  const push = (events || []).find(e => e.type === 'PushEvent' && e.payload?.head && e.repo?.name);
  if (!push) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${API}/repos/${push.repo.name}/commits/${push.payload.head}`, { headers: { Accept: 'application/vnd.github.patch' }, signal: ctrl.signal });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader(); // the Date header is near the top: read one chunk, not a whole big patch
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    const m = new TextDecoder().decode(value || new Uint8Array()).slice(0, 4096).match(/^Date: .* ([+-])(\d{2})(\d{2})$/m);
    if (!m) return null;
    const offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    try { localStorage.setItem(key, JSON.stringify({ offset, t: Date.now() })); } catch { /* no storage */ }
    return offset;
  } catch { return null; } finally { clearTimeout(to); }
}
export function localClockPhase() {
  const h = devLocalTime().h;
  const ramp = (a, b) => THREE.MathUtils.clamp((h - a) / (b - a), 0, 1);
  const light = h < 12 ? ramp(5.5, 8.5) : 1 - ramp(17, 20);
  return Math.acos(light) / (Math.PI * 2);
}
