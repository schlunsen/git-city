/*
 * Vacant-lot planner (pure: no three.js, no DOM). Decides what every empty
 * cell of the city block becomes: a themed lot (park, parking, court, …),
 * part of a little square around an intersection, and which props dress it.
 * Deterministic per profile — same login, same lots. Unit-tested in
 * tests/lots.test.mjs. Rendered by world.js `setLots`.
 *
 * Streets run on every cell boundary (cityStreets, layout.js), so a "square"
 * can never be one continuous pavement: it is four coordinated lots around
 * an intersection, their rotations facing inward, its centrepiece standing
 * on a lot — never on the roadway.
 */
import { hashStr, seededRandom } from './prng.js';

// ---------------------------------------------------------------------------
// Lot kinds. `sprite` is the decal tile index (public/assets/lots-<n>.png);
// `fallback` is used while the tile set is smaller than this catalogue, so
// the code works with any SPRITE_COUNTS.lots. `organic` tiles may rotate
// freely (they read as nature); man-made tiles snap to 90° so their painted
// lines stay parallel to the streets.
// ---------------------------------------------------------------------------
export const LOT_KINDS = [
  { kind: 'parking',      sprite: 0,  fallback: 0, organic: false, zone: 'utility' },
  { kind: 'pond-park',    sprite: 1,  fallback: 1, organic: true,  zone: 'green'   },
  { kind: 'construction', sprite: 2,  fallback: 2, organic: false, zone: 'utility' },
  { kind: 'basketball',   sprite: 3,  fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'lawn',         sprite: 4,  fallback: 1, organic: true,  zone: 'green'   },
  { kind: 'paved',        sprite: 5,  fallback: 2, organic: false, zone: 'civic'   },
  { kind: 'tennis',       sprite: 6,  fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'soccer',       sprite: 7,  fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'playground',   sprite: 8,  fallback: 1, organic: false, zone: 'green'   },
  { kind: 'garden',       sprite: 9,  fallback: 1, organic: true,  zone: 'green'   },
  { kind: 'market',       sprite: 10, fallback: 0, organic: false, zone: 'civic'   },
  { kind: 'fountain',     sprite: 11, fallback: 1, organic: false, zone: 'civic'   },
  { kind: 'skate',        sprite: 12, fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'dog-park',     sprite: 13, fallback: 1, organic: true,  zone: 'green'   },
  { kind: 'track',        sprite: 14, fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'amphitheater', sprite: 15, fallback: 1, organic: false, zone: 'civic'   },
];
export const LOT_KIND = Object.fromEntries(LOT_KINDS.map(k => [k.kind, k]));

// ---------------------------------------------------------------------------
// Zoning. The block is divided into 3x3-cell macro-blocks; each macro-block
// gets a theme from its coords + the login, so the theme of a place is stable
// as vacancy changes, and nearby lots share a mood (a sports corner, a green
// belt, a civic row) instead of a uniform scatter.
// ---------------------------------------------------------------------------
const ZONE_WHEEL = ['green', 'civic', 'green', 'sports', 'civic', 'utility']; // green/civic weighted
export function zoneOf(gx, gz, login = '') {
  const mx = Math.floor((gx + 900) / 3), my = Math.floor((gz + 900) / 3);
  return ZONE_WHEEL[hashStr(`lotzone-v1:${login}:${mx},${my}`) % ZONE_WHEEL.length];
}

// Weighted kind pools per zone. Quiet tiles (lawn, paved, parking) outweigh
// the loud ones so the city reads as a city, not a funfair.
const ZONE_POOLS = {
  sports:  [['basketball', 2], ['tennis', 2], ['soccer', 2], ['skate', 1], ['track', 1]],
  green:   [['lawn', 3], ['pond-park', 2], ['garden', 2], ['playground', 2], ['dog-park', 1]],
  civic:   [['paved', 3], ['market', 1], ['fountain', 1], ['amphitheater', 1]],
  utility: [['parking', 3], ['paved', 2], ['lawn', 2], ['construction', 1]],
};
export const SQUARE_KINDS = ['fountain', 'market', 'garden']; // what a square is built around
const SQUARE_MEMBER = { fountain: 'paved', market: 'paved', garden: 'lawn' }; // the other three quarters

const PROP_LIMIT = 5;
const REACH = 1.6; // props stay this far from the lot centre, clear of the street

// ---------------------------------------------------------------------------
// The planner.
// cells: [{ gx, gz, x, z, seed }] — the vacant lot cells (seed per app.js).
// cell: world units per cell (layout.js CELL, which island.streets moves).
// Returns { lots: [lotPlan], squares: [squarePlan] }.
// lotPlan:   { gx, gz, x, z, seed, kind, rot, flipX, flipZ, tint, scale,
//              square: id|null, corner: {sx, sz}|null, props: [{ p, dx, dz, h, v }] }
// squarePlan:{ id, kind, cells: [{ gx, gz }*4], anchor: { gx, gz } }
// ---------------------------------------------------------------------------
export function planLots(cells, login = '', cell = 9) {
  const sorted = [...cells].sort((a, b) => a.gz - b.gz || a.gx - b.gx);
  const vacant = new Set(sorted.map(c => `${c.gx},${c.gz}`));
  const plan = seededRandom(hashStr(`lots-v1:${login}`));

  // -- Squares: all-vacant 2x2 blocks, seeded-shuffled, greedily claimed.
  const blocks = [];
  for (const c of sorted) {
    const q = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dz]) => `${c.gx + dx},${c.gz + dz}`);
    if (q.every(k => vacant.has(k))) blocks.push({ gx: c.gx, gz: c.gz });
  }
  for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(plan() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
  const maxSquares = blocks.length ? Math.min(3, Math.max(1, Math.round(sorted.length / 24))) : 0;
  const claimed = new Set();
  const squares = [];
  for (const b of blocks) {
    if (squares.length >= maxSquares) break;
    const q = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dz]) => ({ gx: b.gx + dx, gz: b.gz + dz }));
    if (q.some(c => claimed.has(`${c.gx},${c.gz}`))) continue;
    q.forEach(c => claimed.add(`${c.gx},${c.gz}`));
    const kind = SQUARE_KINDS[Math.floor(plan() * SQUARE_KINDS.length)];
    squares.push({ id: squares.length, kind, cells: q, anchor: q[Math.floor(plan() * 4)] });
  }
  const squareOf = new Map(); // cell key -> square
  for (const s of squares) for (const c of s.cells) squareOf.set(`${c.gx},${c.gz}`, s);

  // -- Kinds: squares first (forced), then singles in sorted order, never
  // repeating a kind that already stands on a planned neighbour (Chebyshev 1).
  const planned = new Map(); // cell key -> kind
  const byKey = new Map(sorted.map(c => [`${c.gx},${c.gz}`, c]));
  const forcedKind = (s, c) => (c.gx === s.anchor.gx && c.gz === s.anchor.gz) ? s.kind : SQUARE_MEMBER[s.kind];
  for (const s of squares) for (const c of s.cells) planned.set(`${c.gx},${c.gz}`, forcedKind(s, c));

  const neighbourKinds = c => {
    const used = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const k = planned.get(`${c.gx + dx},${c.gz + dz}`);
      if (k) used.add(k);
    }
    return used;
  };
  const weightedPick = (pool, r) => {
    const total = pool.reduce((a, [, w]) => a + w, 0);
    let d = r() * total;
    for (const [name, w] of pool) { d -= w; if (d <= 0) return name; }
    return pool[pool.length - 1][0];
  };
  for (const c of sorted) {
    const key = `${c.gx},${c.gz}`;
    if (planned.has(key)) continue;
    const r = seededRandom(c.seed);
    const avoid = neighbourKinds(c);
    let pool = ZONE_POOLS[zoneOf(c.gx, c.gz, login)].filter(([name]) => !avoid.has(name));
    // Rare: the zone pool is exhausted by neighbours — any other kind works,
    // 16 kinds > 8 neighbours, so a conflict-free pick always exists.
    if (!pool.length) pool = LOT_KINDS.map(k => [k.kind, 1]).filter(([name]) => !avoid.has(name));
    planned.set(key, weightedPick(pool, r));
  }

  // -- Full plans: transforms + props, all drawn from the cell's own stream.
  const lots = sorted.map(c => {
    const key = `${c.gx},${c.gz}`;
    const kind = planned.get(key);
    const s = squareOf.get(key) || null;
    const r = seededRandom(c.seed);
    r(); // skip the kind-pick draw so singles and square members stream alike
    const organic = LOT_KIND[kind].organic;
    let corner = null, rot;
    if (s) { // face the shared intersection: snap the 45° diagonal to 90° so
      // even organic tiles stay axis-aligned at full size (no street overhang)
      const ix = (Math.min(...s.cells.map(q => q.gx)) + 0.5) * cell; // island.streets moves the cell, so it can't stay a literal 9
      const iz = (Math.min(...s.cells.map(q => q.gz)) + 0.5) * cell;
      corner = { sx: Math.sign(ix - c.x) || 1, sz: Math.sign(iz - c.z) || 1 };
      rot = Math.round(Math.atan2(corner.sz, corner.sx) / (Math.PI / 2)) * (Math.PI / 2);
    } else {
      rot = organic ? r() * Math.PI * 2 : Math.floor(r() * 4) * Math.PI / 2;
    }
    const flipX = r() < 0.5, flipZ = r() < 0.5;
    // A 4.4u decal rotated 45° spans 6.2u — free rotation needs scale <= 0.78
    // so the diagonal (4.9u) stays inside the 5u lot.
    const scale = s ? 0.95 + r() * 0.05 : organic ? 0.70 + r() * 0.08 : 0.92 + r() * 0.08;
    const tint = r() < 0.55 ? 0 : 1 + Math.floor(r() * 3); // plain mostly, else 1..3
    return { gx: c.gx, gz: c.gz, x: c.x, z: c.z, seed: c.seed, kind, rot, flipX, flipZ, tint, scale, square: s ? s.id : null, corner, props: [] };
  });

  // -- Props.
  for (const lot of lots) {
    const r = seededRandom(lot.seed ^ 0x9e3779b9); // own stream: transforms stay stable if prop rules change
    const add = (p, dx, dz, h, v = 0) => { if (lot.props.length < PROP_LIMIT) lot.props.push({ p, dx, dz, h, v }); };
    const spot = reach => (r() * 2 - 1) * reach;
    const tree = () => add('tree', spot(1.4), spot(1.4), 4 + r() * 2.5, Math.floor(r() * 10));
    const bush = () => add('bush', spot(1.5), spot(1.5), 1 + r() * 0.8, Math.floor(r() * 10));
    const bench = () => add('bench', spot(1.2), spot(1.2), 1.3);
    const lamp = (dx, dz) => add('lamp', dx ?? spot(1.4), dz ?? spot(1.4), 3.2);
    const s = lot.square !== null ? squares[lot.square] : null;
    if (s) { // squares: lamps ring the intersection; the anchor carries the centrepiece
      const isAnchor = lot.gx === s.anchor.gx && lot.gz === s.anchor.gz;
      lamp(lot.corner.sx * 1.5, lot.corner.sz * 1.5);
      if (s.kind === 'fountain') { // the anchor's own decal shows the fountain: no prop, or they double up
        if (r() < 0.5) bench();
      } else if (s.kind === 'market') {
        if (isAnchor) { add('cart', lot.corner.sx * 1.2, lot.corner.sz * 0.6, 2.6); add('news-stand', lot.corner.sx * 0.6, lot.corner.sz * 1.2, 2.2); }
        if (r() < 0.5) bench();
      } else { // garden square
        tree(); if (isAnchor) { tree(); bush(); bench(); }
      }
      continue;
    }
    switch (lot.kind) {
      case 'pond-park': case 'garden': case 'dog-park':
        tree(); tree(); if (r() < 0.5) tree();
        if (r() < 0.6) bush();
        if (r() < 0.6) bench();
        if (r() < 0.4) lamp();
        break;
      case 'lawn':
        if (r() < 0.7) tree();
        if (r() < 0.4) bush();
        if (r() < 0.3) bench();
        break;
      case 'playground':
        tree();
        if (r() < 0.6) bench();
        if (r() < 0.3) lamp();
        break;
      case 'paved': case 'amphitheater':
        if (r() < 0.5) lamp();
        if (r() < 0.5) bench();
        break;
      case 'market':
        lamp(); add('cart', spot(1.2), spot(1.2), 2.6); if (r() < 0.5) add('news-stand', spot(1.2), spot(1.2), 2.2);
        break;
      case 'fountain': // the decal already has the fountain; just dress the plaza
        if (r() < 0.6) lamp();
        if (r() < 0.5) bench();
        break;
      case 'parking':
        if (r() < 0.2) add('cart', spot(1.2), spot(1.2), 2.6);
        break;
      case 'construction':
        break; // the decal says it all
      default: // courts & tracks: keep the playing surface clear — a bike rack at a corner, no lamps mid-field
        if (r() < 0.3) add('bike-rack', (r() < 0.5 ? -1.5 : 1.5), (r() < 0.5 ? -1.5 : 1.5), 1.3);
    }
  }
  // Clamp prop offsets into the lot (belt-and-braces; tests assert it).
  for (const lot of lots) for (const p of lot.props) {
    p.dx = Math.max(-REACH, Math.min(REACH, p.dx));
    p.dz = Math.max(-REACH, Math.min(REACH, p.dz));
  }
  return { lots, squares };
}
