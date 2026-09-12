/*
 * City layout math (pure: no three.js, no DOM): the block grid, the per-profile
 * city footprint (signed distance fields -> lots, streets, exits), language
 * districts and the star -> height / footprint scales. Unit-tested in
 * tests/layout.test.mjs.
 */
import { LANG_COLORS, FALLBACK_COLOR } from './constants.js';

// ---------------------------------------------------------------------------
// Layout math
// ---------------------------------------------------------------------------
const BLOCK = 11;    // cells per side of the building district
// A cell is one lot plus the street beside it. The lot is fixed, so widening
// the streets (city.json island.streets) grows the cell and spreads the city
// out rather than slimming every building — see setStreetWidth.
export const LOT = 5;      // buildable lot between two streets: fixed at every street width
export const SLAB_R = 15;  // corner radius — the block melts into the island
// SLAB_HALF - RING_R is the +7 below whatever the cell is, so both of these are
// the same at every street width.
export const SIDEWALK = 7;                 // boulevard centreline -> slab edge
export const RING_CORNER = SLAB_R - SIDEWALK; // concentric with the slab corners
// Recomputed by setStreetWidth. They are `let`, so nothing may cache them (or
// anything derived from them) at module load: read them where you use them.
export let CELL;           // world units per cell
export let DISTRICT;       // four quadrants -> total district size
export let SLAB_HALF;      // the paved block, sidewalk included
export let RING_R;         // boulevard centreline half-size
export let PLAZA_R;        // central town square, kept clear of buildings

// ---------------------------------------------------------------------------
// City footprints. Every profile gets one (same login, same shape). A shape
// is a signed distance function in world units (< 0 inside) whose zero
// contour is the boulevard's centreline. That contour is polar ray-marched
// into a polygon (every shape is star-shaped from the plaza), then the exact
// distance to the polygon is baked on a grid: lanes, curbs, the slab edge and
// the island's verge are all iso-contours of that one field, so they stay
// concentric. A cell is active when a full-size building clears the boulevard.
// ---------------------------------------------------------------------------
export const BOULEVARD_HALF = 1.6;          // paved half-width of the boulevard ring; its ink curb runs 0.4 further
export const LANE_OFFSET = 0.85;            // boulevard car lanes either side of its centreline
export const LOT_CLEAR = BOULEVARD_HALF + 0.75; // footprint corners this far inside the centreline: roofs clear the boulevard's curb

// Inner streets, centred on the cell boundaries, beside a lot of a fixed LOT.
export const STREET_DEFAULT = 4;   // the classic cell: a 5-unit lot and a 4-unit street, CELL 9
// 6 puts the widest block at a radius of ~90 inside a ~148 shore, which still
// leaves a ring of countryside; 7 starts to crowd the island out.
export const STREET_RANGE = [3, 6];
const LOT_MARGIN = 0.45;           // pavement between a building's edge and the kerb
export const LOT_HALF = LOT / 2 - LOT_MARGIN; // largest building half-footprint: 2.05 at every width
export let STREET_W;

// Widen the streets and the cell grows with them, so the buildings keep their
// size and the city simply spreads out. (Taking the width out of the lot
// instead made every tower a pencil: at a 3-unit lot the largest building was
// half its normal width.) Set this before the layout is planned — the grid, the
// boulevard, the plaza and every road mesh are measured from CELL.
export function setStreetWidth(w) {
  const [lo, hi] = STREET_RANGE;
  const n = Number.isFinite(+w) ? Math.min(hi, Math.max(lo, +w)) : STREET_DEFAULT;
  STREET_W = n;
  CELL = LOT + n;
  DISTRICT = BLOCK * CELL;
  SLAB_HALF = DISTRICT / 2 + SIDEWALK;
  RING_R = (BLOCK / 2) * CELL;
  PLAZA_R = CELL * 1.7;
  return n;
}
setStreetWidth(STREET_DEFAULT); // the module's own defaults, before anything reads them
const SHAPE_TAU = Math.PI * 2;
function sdRoundBox(x, z, hx, hz, r) {
  const qx = Math.abs(x) - hx + r, qz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}
function sminPoly(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; }
// { base, make(n, seed) -> { cols, rows, sdf } }. The grid is cols x rows cells
// (odd, so the plaza sits on the middle cell); n grows by 2 until all repos fit.
const CITY_SHAPES = {
  square: { base: 11, make: n => ({ cols: n, rows: n, sdf: (x, z) => sdRoundBox(x, z, n * CELL / 2, n * CELL / 2, RING_CORNER) }) },
  wide: { base: 11, make: n => ({ cols: n + 2, rows: n - 2, sdf: (x, z) => sdRoundBox(x, z, (n + 2) * CELL / 2, (n - 2) * CELL / 2, 11) }) },
  tall: { base: 11, make: n => ({ cols: n - 2, rows: n + 2, sdf: (x, z) => sdRoundBox(x, z, (n - 2) * CELL / 2, (n + 2) * CELL / 2, 11) }) },
  round: { base: 13, make: n => ({ cols: n, rows: n, sdf: (x, z) => Math.hypot(x, z) - (n * CELL / 2 + 1) }) },
  plus: { base: 13, make: n => { // a cross: the corner cells are gone, the inside corners filleted
    const L = n * CELL / 2, W = (n - 6) * CELL / 2;
    return { cols: n, rows: n, sdf: (x, z) => sminPoly(sdRoundBox(x, z, L, W, 9), sdRoundBox(x, z, W, L, 9), 16) };
  } },
  octagon: { base: 13, make: n => { // chamfered square with rounded corners
    const h = n * CELL / 2; // a regular octagon: the diagonal flats as far out as the straight ones
    return { cols: n, rows: n, sdf: (x, z) => -sminPoly(-sdRoundBox(x, z, h, h, 0), -((Math.abs(x) + Math.abs(z)) / Math.SQRT2 - h), 10) };
  } },
  blob: { base: 13, make: (n, seed) => { // an organic outline, its wobble seeded by the login
    let s = seed >>> 0;
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
    const R = n * CELL / 2, p = [rnd(), rnd(), rnd()].map(v => v * SHAPE_TAU), sq = 0.5 + rnd() * 0.6;
    const rAt = a => R * (1 + 0.07 * Math.sin(2 * a + p[0]) + 0.045 * Math.sin(3 * a + p[1]) + 0.02 * Math.sin(5 * a + p[2]))
      * (1 + 0.05 * sq * Math.cos(4 * a) ** 2);
    return { cols: n, rows: n, sdf: (x, z) => (Math.hypot(x, z) - rAt(Math.atan2(z, x))) * 0.9 };
  } },
};
export const CITY_SHAPE_NAMES = ['square', 'wide', 'tall', 'round', 'plus', 'octagon', 'blob'];
// `seed` hashes the login (+ account year); a valid `override` (?city=round) wins.
export function chooseCityShape(seed, override) {
  if (CITY_SHAPES[override]) return override;
  return CITY_SHAPE_NAMES[(seed >>> 0) % CITY_SHAPE_NAMES.length];
}

// Polar ray-march: per bearing, the first radius where f rises through `level`.
function polarContour(f, level, maxR, N = 360) {
  const pts = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * SHAPE_TAU, c = Math.cos(a), s = Math.sin(a);
    let lo = 0, hi = maxR;
    for (let r = 1.5; r < maxR; r += 1.5) { if (f(c * r, s * r) > level) { hi = r; break; } lo = r; }
    for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (f(c * m, s * m) > level) hi = m; else lo = m; }
    const r = (lo + hi) / 2;
    pts.push({ x: c * r, z: s * r });
  }
  return pts;
}

function buildCityLayout(shape, n, seed) {
  const def = CITY_SHAPES[shape].make(n, seed);
  const { cols, rows } = def, hx = (cols - 1) / 2, hz = (rows - 1) / 2;
  const reach = Math.hypot(cols, rows) * CELL / 2 + 12;
  // 1. The boulevard centreline as a polygon.
  const line = polarContour(def.sdf, 0, reach);
  const N = line.length, ax = new Float64Array(N), az = new Float64Array(N), ex = new Float64Array(N), ez = new Float64Array(N), il = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = line[i], q = line[(i + 1) % N];
    ax[i] = p.x; az[i] = p.z; ex[i] = q.x - p.x; ez[i] = q.z - p.z; il[i] = 1 / (ex[i] * ex[i] + ez[i] * ez[i]);
  }
  const rMax = Math.max(...line.map(p => Math.hypot(p.x, p.z)));
  const exact = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      const px = x - ax[i], pz = z - az[i];
      let t = (px * ex[i] + pz * ez[i]) * il[i];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ex[i] * t, dz = pz - ez[i] * t, d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    // Inside or out: compare with the polygon's radius on this bearing.
    const f = ((Math.atan2(z, x) / SHAPE_TAU) % 1 + 1) % 1 * N, k = Math.floor(f) % N;
    const p = line[k], q = line[(k + 1) % N], c = Math.cos(f / N * SHAPE_TAU), s = Math.sin(f / N * SHAPE_TAU);
    const qx = q.x - p.x, qz = q.z - p.z, r = (p.x * qz - p.z * qx) / (c * qz - s * qx);
    return Math.hypot(x, z) < r ? -Math.sqrt(best) : Math.sqrt(best);
  };
  // 2. Bake the field on a grid; bilinear lookups are cheap enough for the island's heightfield.
  const H = 1.5, G0 = -(rMax + SIDEWALK + 40), GN = Math.ceil(-2 * G0 / H) + 1;
  const field = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) field[j * GN + i] = exact(G0 + i * H, G0 + j * H);
  const dist = (x, z) => {
    const u = (x - G0) / H, v = (z - G0) / H;
    const cu = Math.min(Math.max(u, 0), GN - 1.001), cv = Math.min(Math.max(v, 0), GN - 1.001);
    const i = Math.floor(cu), j = Math.floor(cv), fu = cu - i, fv = cv - j, o = j * GN + i;
    const d = (field[o] * (1 - fu) + field[o + 1] * fu) * (1 - fv) + (field[o + GN] * (1 - fu) + field[o + GN + 1] * fu) * fv;
    return u === cu && v === cv ? d : d + Math.hypot((u - cu) * H, (v - cv) * H); // off the grid: keeps growing
  };
  const contours = new Map();
  const contour = (level, M = 360) => { // memoised; callers must not mutate the result
    const key = `${level}:${M}`;
    if (!contours.has(key)) contours.set(key, polarContour(dist, level, reach + Math.max(0, level) + 4, M));
    return contours.get(key);
  };
  // 3. Cells: active when a full-size footprint clears the boulevard; `lot`
  // when at least an empty-lot decal fits (the ragged edge of round shapes).
  const fits = (x, z, half, clear) => dist(x - half, z - half) <= -clear && dist(x + half, z - half) <= -clear
    && dist(x - half, z + half) <= -clear && dist(x + half, z + half) <= -clear;
  const cells = [];
  for (let gx = -hx; gx <= hx; gx++) for (let gz = -hz; gz <= hz; gz++) {
    const { x, z } = worldForCell(gx, gz);
    const plaza = Math.hypot(Math.max(0, Math.abs(x) - 3.2), Math.max(0, Math.abs(z) - 3.2)) <= CELL * 1.7;
    const active = fits(x, z, LOT_HALF, LOT_CLEAR);
    cells.push({ gx, gz, x, z, plaza, active, inside: plaza || active, lot: !plaza && (active || fits(x, z, 2.2, BOULEVARD_HALF + 0.6)) });
  }
  const byKey = new Map(cells.map(c => [`${c.gx},${c.gz}`, c]));
  const L = { shape, n, seed, cols, rows, hx, hz, cells, dist, contour, reach, rMax, cellAt: (gx, gz) => byKey.get(`${gx},${gz}`) };
  L.capacity = cells.filter(c => c.active && !c.plaza).length;
  L.streets = cityStreets(L);
  // 4. Country roads leave where the two central axes cross the slab edge.
  L.exits = [0, 1, 2, 3].map(k => {
    const a = k * Math.PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
    let lo = 0, hi = reach + SIDEWALK;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (dist(c * m, s * m) > SIDEWALK + 0.3) hi = m; else lo = m; }
    const x = c * lo, z = s * lo, e = 0.5;
    const gx = dist(x + e, z) - dist(x - e, z), gz = dist(x, z + e) - dist(x, z - e), gl = Math.hypot(gx, gz) || 1;
    return { a, x, z, nx: gx / gl, nz: gz / gl };
  });
  return L;
}

// Inner streets run on the cell boundaries wherever they border a cell inside
// the block, and reach out to meet the boulevard when it is close by (so a
// curved edge never leaves dead ends). Returns centrelines { x0, z0, x1, z1, vertical }.
function cityStreets(L) {
  const out = [];
  const reachOut = (px, pz, dx, dz) => { // how far to move an end (along d) onto the centreline
    if (L.dist(px, pz) >= 0) { // a cell corner past a steep curve: pull back instead
      for (let t = 0.25; t <= CELL / 2; t += 0.25) if (L.dist(px - dx * t, pz - dz * t) < 0) return -t;
      return 0;
    }
    for (let t = 0; t <= CELL * 1.5; t += 0.25) if (L.dist(px + dx * t, pz + dz * t) >= 0) return t;
    return 0;
  };
  for (const vertical of [true, false]) {
    const across = vertical ? L.hx : L.hz, along = vertical ? L.hz : L.hx;
    for (let i = -across; i < across; i++) {
      const p = (i + 0.5) * CELL;
      const inside = k => {
        const a = vertical ? L.cellAt(i, k) : L.cellAt(k, i), b = vertical ? L.cellAt(i + 1, k) : L.cellAt(k, i + 1);
        return !!((a && a.inside) || (b && b.inside));
      };
      for (let k = -along; k <= along; k++) {
        if (!inside(k)) continue;
        let e = k;
        while (e + 1 <= along && inside(e + 1)) e++;
        let t0 = (k - 0.5) * CELL, t1 = (e + 0.5) * CELL;
        t0 -= vertical ? reachOut(p, t0, 0, -1) : reachOut(t0, p, -1, 0);
        t1 += vertical ? reachOut(p, t1, 0, 1) : reachOut(t1, p, 1, 0);
        out.push(vertical ? { x0: p, z0: t0, x1: p, z1: t1, vertical } : { x0: t0, z0: p, x1: t1, z1: p, vertical });
        k = e;
      }
    }
  }
  return out;
}

const cityLayouts = new Map();
// The smallest size of `shape` that fits `need` buildings. Same inputs, same object.
export function makeCityLayout(shape = 'square', need = 100, seed = 0) {
  const S = CITY_SHAPES[shape] ? shape : 'square';
  for (let n = CITY_SHAPES[S].base; ; n += 2) {
    // STREET_W belongs in the key: it sets LOT_HALF, which decides which cells
    // are active, so the same shape at two street widths is two layouts.
    const key = `${S}:${n}:${S === 'blob' ? seed >>> 0 : 0}:${STREET_W}`;
    let L = cityLayouts.get(key);
    if (!L) {
      L = buildCityLayout(S, n, seed);
      if (cityLayouts.size >= 12) cityLayouts.delete(cityLayouts.keys().next().value);
      cityLayouts.set(key, L);
    }
    if (L.capacity >= need || n >= CITY_SHAPES[S].base + 8) return L;
  }
}

// Language -> (name, district color). Shared by building palette + districts.
const LANG_META = {
  TypeScript: { name: 'TypeScript District', color: 0x3178c6 },
  Python:     { name: 'Python Quarter',      color: 0x3572a5 },
  JavaScript: { name: 'JavaScript Zone',     color: 0xf1e05a },
  Go:         { name: 'Go Harbor',           color: 0x00add8 },
  Rust:       { name: 'Rust Foundry',        color: 0xf74c00 },
  C:          { name: 'C Core',              color: 0x8a8a99 },
  'C++':      { name: 'C++ Heights',         color: 0x8f9bc0 },
  'C#':       { name: 'C# Plaza',            color: 0x8c47d1 },
  Ruby:       { name: 'Ruby Block',          color: 0x701516 },
  PHP:        { name: 'PHP Rows',            color: 0x777bb3 },
  Swift:      { name: 'Swift Park',          color: 0xf05138 },
  Kotlin:     { name: 'Kotlin Corner',       color: 0x7f52ff },
  Java:       { name: 'Java Flats',          color: 0xe76f00 },
  Shell:      { name: 'Shell Alley',         color: 0x89e051 },
  HTML:       { name: 'HTML Market',         color: 0xe34c26 },
  CSS:        { name: 'CSS Studio',          color: 0x563d7c },
  Vue:        { name: 'Vue Garden',          color: 0x41b883 },
  Dart:       { name: 'Dart Yard',           color: 0x00b4ab },
  Scala:      { name: 'Scala Ridge',         color: 0xc22d40 },
  Julia:      { name: 'Julia Lab',           color: 0xa270ba },
  Elixir:     { name: 'Elixir Court',        color: 0x6e4a7e },
  Zig:        { name: 'Zig Works',           color: 0xffc50f },
  Assembly:   { name: 'Assembly Vault',      color: 0x6e4a3e },
  'Jupyter Notebook': { name: 'Notebook Labs', color: 0xda5b0b },
};
const OTHER_META = { name: 'Innovation District', color: FALLBACK_COLOR };
export function langMeta(lang) {
  const key = (lang || '').toLowerCase();
  const named = LANG_META[lang] || Object.entries(LANG_META).find(([name]) => name.toLowerCase() === key)?.[1] || OTHER_META;
  // Prefer the canonical building palette color when present.
  const color = LANG_COLORS[key] ?? named.color;
  return { name: named.name, color };
}

// Map a star count to a building height (log scale, so 100k-star repos tower
// over 0-star ones without dwarfing the whole district).
export function starsToHeight(stars) {
  return 4 + Math.log10(stars + 1) * 6.5; // 4u..~40u
}
export function starsToFootprint(stars) {
  const t = Math.min(1, Math.log10(stars + 1) / 6);
  return 3.2 + t * 0.9; // 3.2..4.1 world units: with its roof overhang every building stays on its 5-unit lot, clear of the street
}

// The layout's building cells (active, off the plaza), ranked by ring distance
// from the plaza, then by a fixed zigzag for variety. Deterministic order so
// re-renders of the same data are stable.
function assignSlots(L) {
  return L.cells.filter(c => c.active && !c.plaza)
    .map(c => ({ gx: c.gx, gz: c.gz, dist: Math.max(Math.abs(c.gx), Math.abs(c.gz)) })) // chebyshev
    .sort((a, b) => a.dist !== b.dist ? a.dist - b.dist : (a.gx + a.gz) - (b.gx + b.gz));
}

// Cells are addressed from the plaza: (0, 0) is the middle cell.
export function worldForCell(gx, gz) {
  return { x: gx * CELL, z: gz * CELL };
}

// ---------------------------------------------------------------------------
// Topic districts — cluster repos into language neighborhoods on four
// quadrants around the plaza. Tallest repos in each cluster sit nearest the
// plaza (innermost quadrant cells). This is what turns the city from a sorted
// list into a *planned city*.
// ---------------------------------------------------------------------------
const QUADRANTS = [
  { cx:  1, cz:  1 }, // NE (gx>=mid, gz>=mid)
  { cx: -1, cz:  1 }, // NW
  { cx:  1, cz: -1 }, // SE
  { cx: -1, cz: -1 }, // SW
];

// Group repos by language, then pack the dominant languages onto quadrants.
// Returns { byCell: Map<gx+','+gz, repo>, assignments: [{repo,gx,gz,district}] }.
// Only the layout's active cells are used; the plaza (with a building's half
// footprint) is always reserved.
export function assignDistricts(ranked, L = makeCityLayout('square')) {
  const available = assignSlots(L);
  const clusters = new Map();
  for (const repo of ranked) {
    const key = (repo.language || 'other').toLowerCase();
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(repo);
  }
  const assignments = [], byCell = new Map();
  const ordered = [...clusters.entries()].sort((a, b) =>
    b[1].reduce((sum, r) => sum + r.stargazers_count, 0) - a[1].reduce((sum, r) => sum + r.stargazers_count, 0));
  ordered.forEach(([district, repos], index) => {
    const q = QUADRANTS[index % 4];
    const anchor = { gx: q.cx * 2, gz: q.cz * 2 };
    for (const repo of repos) {
      available.sort((a, b) =>
        Math.hypot(a.gx - anchor.gx, a.gz - anchor.gz) - Math.hypot(b.gx - anchor.gx, b.gz - anchor.gz));
      const cell = available.shift();
      if (!cell) break;
      assignments.push({ repo, gx: cell.gx, gz: cell.gz, district });
      byCell.set(`${cell.gx},${cell.gz}`, repo);
    }
  });
  return { byCell, assignments };
}
