// ---------------------------------------------------------------------------
// game-rules.js — the pure rules of the bomb run (game.js): tuning constants,
// hit points, damage stages, scoring, combo, bomb regen and HUD formatting.
//
// No imports, no DOM, no WebGL: unit-tested directly by tests/game.test.mjs.
// game.js re-exports all of it.
// ---------------------------------------------------------------------------

export const GAME = Object.freeze({
  FIRE_RATE: 8,          // rounds per second
  BULLET_SPEED: 150,     // world units per second, on top of the plane's velocity
  BULLET_LIFE: 1.5,      // seconds
  BULLET_DAMAGE: 4,
  SPREAD: 0.012,         // radians of scatter
  BOMB_MAX: 3,
  BOMB_REGEN: 2,         // seconds per bomb
  BOMB_RADIUS: 7,
  BOMB_DAMAGE: 90,       // at ground zero
  GRAVITY: 20,
  COMBO_WINDOW: 6,       // seconds between kills to keep a combo going
  COMBO_MAX: 8,
  CRUMBLE: 2.5,          // seconds for the final collapse
  COUNTDOWN: 2.4,        // 3 · 2 · 1, then GO!
  PLANE_RADIUS: 0.5,     // crash margin around the fuselage (fair: no near-miss deaths)
});

/** What each damage stage looks like, for the HUD. */
export const STAGE_LABELS = Object.freeze(['intact', 'roof gone', 'top floor down', 'upper floors down', 'on fire', 'destroyed']);
const STAGE_AT = [0.8, 0.6, 0.4, 0.2]; // HP fractions where stages 1..4 begin

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Hit points for a building of `height` (top of the roof) and `footprint` (width). */
export function buildingHp(height, footprint) {
  const h = Math.max(1, Number(height) || 0), f = Math.max(1, Number(footprint) || 0);
  return Math.round(clamp(12 + 0.9 * h * f, 16, 420));
}
/** Damage after `dmg`; never below zero. */
export function applyDamage(hp, dmg) {
  return Math.max(0, (Number(hp) || 0) - Math.max(0, Number(dmg) || 0));
}
/** Damage stage 0..5 for `hp` of `max`: 0 intact, 1 roof gone, 2 top floor down, 3 upper floors down, 4 on fire, 5 destroyed. */
export function damageStage(hp, max) {
  if (!(max > 0) || !(hp > 0)) return 5;
  const f = hp / max;
  let s = 0;
  for (const t of STAGE_AT) if (f < t) s++;
  return s;
}
/**
 * What is left of a building with `tiers` tiers at `stage`: roof props on it,
 * how many tiers stand (removed top-down, at least one until the end), how much
 * of the last tier's height has come off in chunks, and whether it leans / burns.
 */
export function structureAt(tiers, stage) {
  const n = Math.max(1, Math.floor(Number(tiers) || 1)), s = clamp(Math.floor(Number(stage) || 0), 0, 5);
  if (s >= 5) return { roof: false, tiers: 0, cut: 1, lean: true, fire: true, smoke: true, destroyed: true };
  const units = s >= 4 ? 3 : s >= 3 ? 2 : s >= 2 ? 1 : 0; // pieces knocked off so far
  const drop = Math.min(n - 1, units);                     // whole tiers first...
  return { roof: s < 1, tiers: n - drop, cut: Math.min(0.6, (units - drop) * 0.25), // ...then chunks of the last one
    lean: s >= 4, fire: s >= 4, smoke: s >= 2, destroyed: false };
}
/** HP bar tone for a fraction left. */
export function hpTone(frac) {
  return frac >= 0.6 ? 'ok' : frac >= 0.3 ? 'warn' : 'bad';
}
/** Bomb damage at `dist` from the blast: full at ground zero, zero at the radius. */
export function bombDamage(dist, radius = GAME.BOMB_RADIUS, max = GAME.BOMB_DAMAGE) {
  const d = Math.max(0, Number(dist) || 0);
  if (!(radius > 0) || d >= radius) return 0;
  const k = d / radius;
  return Math.round(max * (1 - k * k));
}
/** The combo after a kill that came `since` seconds after the previous one. */
export function nextCombo(combo, since, window = GAME.COMBO_WINDOW, max = GAME.COMBO_MAX) {
  return since >= 0 && since <= window ? Math.min(max, Math.max(1, combo | 0) + 1) : 1;
}
/** Points for destroying a repo with `stars` at combo multiplier `combo`. */
export function killScore(stars, combo = 1) {
  return Math.round((100 + Math.max(0, Math.floor(Number(stars) || 0))) * Math.max(1, combo | 0));
}
/** Percentage of shots that hit (0 when nothing was fired). */
export function accuracy(hits, shots) {
  return shots > 0 ? Math.round((100 * Math.min(Math.max(0, hits), shots)) / shots) : 0;
}
/** Bomb charges after `dt` seconds: one comes back every `regen` seconds up to `max`. */
export function regenBombs(bombs, timer, dt, max = GAME.BOMB_MAX, regen = GAME.BOMB_REGEN) {
  if (bombs >= max) return { bombs: max, timer: 0 };
  let t = timer + Math.max(0, dt), b = bombs;
  while (t >= regen && b < max) { t -= regen; b++; }
  return { bombs: b, timer: b >= max ? 0 : t };
}
/** 248000 -> "248k", 1500 -> "1.5k", 2300000 -> "2.3M". */
export function formatStars(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e5) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
}
/** Seconds -> "m:ss". */
export function formatTime(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}
/** Distance from point p to an axis-aligned box { min, max } (0 inside). */
export function boxDistance(p, box) {
  const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x);
  const dy = Math.max(box.min.y - p.y, 0, p.y - box.max.y);
  const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z);
  return Math.hypot(dx, dy, dz);
}
/** Outward normal of the box face nearest to a point on (or in) it; the roof, never the floor. */
export function faceNormal(p, box) {
  const c = [[p.x - box.min.x, -1, 0, 0], [box.max.x - p.x, 1, 0, 0], [box.max.y - p.y, 0, 1, 0],
    [p.z - box.min.z, 0, 0, -1], [box.max.z - p.z, 0, 0, 1]];
  let best = c[0];
  for (const f of c) if (Math.abs(f[0]) < Math.abs(best[0])) best = f;
  return { x: best[1], y: best[2], z: best[3] };
}
/** localStorage key for the best score on a login's island. */
export function bestKey(login) {
  return `gc-bombrun-best:${String(login || '').toLowerCase()}`;
}
