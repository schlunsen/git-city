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

// Bump alongside the plot module URLs in index.html when replacing this set.
export const LOT_ASSET_VERSION = 'plots-20260913';

// ---------------------------------------------------------------------------
// Lot kinds. `sprite` is the decal tile index (public/assets/lots-<n>.png);
// `fallback` is used while the tile set is smaller than this catalogue, so
// the code works with any SPRITE_COUNTS.lots. All current tiles contain
// rectangular borders or paths, so they snap to 90° and fill their plots.
// ---------------------------------------------------------------------------
export const LOT_KINDS = [
  { kind: 'parking',      sprite: 0,  fallback: 0, organic: false, zone: 'utility' },
  { kind: 'pond-park',    sprite: 1,  fallback: 1, organic: false, zone: 'green'   },
  { kind: 'construction', sprite: 2,  fallback: 2, organic: false, zone: 'utility' },
  { kind: 'basketball',   sprite: 3,  fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'lawn',         sprite: 4,  fallback: 1, organic: false, zone: 'green'   },
  { kind: 'paved',        sprite: 5,  fallback: 2, organic: false, zone: 'civic'   },
  { kind: 'tennis',       sprite: 6,  fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'soccer',       sprite: 7,  fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'playground',   sprite: 8,  fallback: 1, organic: false, zone: 'green'   },
  { kind: 'garden',       sprite: 9,  fallback: 1, organic: false, zone: 'green'   },
  { kind: 'market',       sprite: 10, fallback: 0, organic: false, zone: 'civic'   },
  { kind: 'fountain',     sprite: 11, fallback: 1, organic: false, zone: 'civic'   },
  { kind: 'skate',        sprite: 12, fallback: 3, organic: false, zone: 'sports'  },
  { kind: 'dog-park',     sprite: 13, fallback: 1, organic: false, zone: 'green'   },
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
    let corner = null, rot;
    if (s) { // face the shared intersection, snapped to the street grid
      const ix = (Math.min(...s.cells.map(q => q.gx)) + 0.5) * cell; // island.streets moves the cell, so it can't stay a literal 9
      const iz = (Math.min(...s.cells.map(q => q.gz)) + 0.5) * cell;
      corner = { sx: Math.sign(ix - c.x) || 1, sz: Math.sign(iz - c.z) || 1 };
      rot = Math.round(Math.atan2(corner.sz, corner.sx) / (Math.PI / 2)) * (Math.PI / 2);
    } else {
      rot = Math.floor(r() * 4) * Math.PI / 2;
    }
    const flipX = r() < 0.5, flipZ = r() < 0.5;
    // The complete tile includes its own sidewalk: uniform footprints and
    // the original palette keep adjacent plots visually consistent.
    const scale = 1;
    const tint = 0;
    return { gx: c.gx, gz: c.gz, x: c.x, z: c.z, seed: c.seed, kind, rot, flipX, flipZ, tint, scale, square: s ? s.id : null, corner, props: [] };
  });

  // Detailed decals already contain their own beds, equipment and paths.
  // Only the two open surfaces have room for additional upright scenery.
  // Slots use decal-local coordinates so mirrors, rotation and scale move
  // the props with the artwork (especially the winding lawn path).
  for (const lot of lots) {
    const r = seededRandom(lot.seed ^ 0x9e3779b9);
    const add = (p, x, z, h, v = 0) => {
      x *= lot.scale * (lot.flipX ? -1 : 1);
      z *= lot.scale * (lot.flipZ ? -1 : 1);
      const cos = Math.cos(lot.rot), sin = Math.sin(lot.rot);
      lot.props.push({ p, dx: x * cos + z * sin, dz: z * cos - x * sin, h, v });
    };
    if (lot.kind === 'lawn') {
      // One modest tree on the grass, with the central walking path open.
      if (lot.square !== null || r() < 0.8) add('tree', -1.25, 0, 2.5 + r() * 0.5, Math.floor(r() * 10));
      if (r() < 0.45) add('bush', 1.25, 0.9, 0.65 + r() * 0.2, Math.floor(r() * 10));
    } else if (lot.kind === 'paved') {
      if (lot.corner) {
        // These coordinates face the shared intersection in world space.
        lot.props.push({ p: 'lamp', dx: lot.corner.sx * 1.5, dz: lot.corner.sz * 1.5, h: 2.8, v: 0 });
        lot.props.push({ p: 'bench', dx: -lot.corner.sx * 1.2, dz: -lot.corner.sz * 1.2, h: 0.95, v: 0 });
      } else {
        add('bench', -1.2, -1.2, 0.95);
        if (r() < 0.65) add('lamp', 1.4, 1.4, 2.8);
      }
    }
  }
  return { lots, squares };
}
