import test from 'node:test';
import assert from 'node:assert/strict';
// The planner is pure math (like layout.js): no WebGL or network needed.
import { planLots, zoneOf, LOT_KINDS, LOT_KIND, SQUARE_KINDS } from '../public/city/lots.js';
import { hashStr } from '../public/city/prng.js';
import { assignDistricts, makeCityLayout, CITY_SHAPE_NAMES } from '../public/city/layout.js';

const reposFor = (languages, n) =>
  Array.from({ length: n }, (_, i) => ({ name: `repo-${i}`, language: languages[i % languages.length], stargazers_count: n - i }));

// Build the vacant-cell set exactly as app.js buildCity() does.
const vacantFor = (shape, nRepos, login = 'tester') => {
  const L = makeCityLayout(shape, Math.max(1, nRepos), 7);
  const repos = reposFor(['TypeScript', 'Python', 'Go'], nRepos);
  const used = new Set(assignDistricts(repos, L).assignments.map(a => `${a.gx},${a.gz}`));
  return L.cells
    .filter(c => c.lot && !used.has(`${c.gx},${c.gz}`))
    .map(c => ({ gx: c.gx, gz: c.gz, x: c.x, z: c.z, seed: hashStr(`${login}:${c.gx + L.hx},${c.gz + L.hz}`) }));
};

const key = l => `${l.gx},${l.gz}`;
const chebyshev = (a, b) => Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gz - b.gz));

// Hand-rolled cell sets for the small deterministic cases.
const cellsFor = coords => coords.map(([gx, gz]) => ({ gx, gz, x: gx * 9, z: gz * 9, seed: hashStr(`tester:${gx},${gz}`) }));
const GRID = cellsFor((() => { const out = []; for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) out.push([x, z]); return out; })());

test('deterministic: same inputs, same plan; different logins, different plans', () => {
  const a = planLots(GRID, 'tester');
  assert.equal(JSON.stringify(a), JSON.stringify(planLots([...GRID].reverse(), 'tester')), 'input order must not matter');
  const plans = ['alice', 'bob', 'carol'].map(l => JSON.stringify(planLots(GRID, l)));
  assert.equal(new Set(plans).size, 3, 'three logins, three plans');
  assert.notEqual(JSON.stringify(planLots(GRID, 'alice')), JSON.stringify(a));
});

test('coverage: every vacant cell is planned exactly once', () => {
  const { lots, squares } = planLots(GRID, 'tester');
  assert.equal(lots.length, GRID.length);
  assert.equal(new Set(lots.map(key)).size, GRID.length);
  const members = squares.flatMap(s => s.cells.map(key));
  for (const m of members) assert.ok(lots.some(l => key(l) === m && l.square !== null), `square member ${m} planned`);
  for (const l of lots.filter(l => l.square === null)) assert.ok(!members.includes(key(l)), 'singles and squares are disjoint');
});

test('squares: only on vacant cells, never overlapping, at most three, well-formed', () => {
  for (const login of ['tester', 'alice', 'bob', 'carol', 'dave', 'erin']) {
    const { lots, squares } = planLots(GRID, login);
    const vacant = new Set(GRID.map(c => `${c.gx},${c.gz}`));
    const claimed = new Set();
    assert.ok(squares.length <= 3);
    for (const s of squares) {
      assert.ok(SQUARE_KINDS.includes(s.kind));
      assert.equal(s.cells.length, 4);
      assert.ok(s.cells.some(c => c.gx === s.anchor.gx && c.gz === s.anchor.gz), 'anchor is a member');
      for (const c of s.cells) {
        assert.ok(vacant.has(`${c.gx},${c.gz}`), 'squares claim only vacant cells');
        assert.ok(!claimed.has(`${c.gx},${c.gz}`), 'squares never overlap');
        claimed.add(`${c.gx},${c.gz}`);
        const lot = lots.find(l => l.gx === c.gx && l.gz === c.gz);
        assert.equal(lot.square, s.id);
        assert.deepEqual([Math.abs(lot.corner.sx), Math.abs(lot.corner.sz)], [1, 1], 'corner points at the intersection');
      }
    }
  }
});

test('no two neighbouring singles share a kind', () => {
  for (const login of ['tester', 'alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace']) {
    const { lots } = planLots(GRID, login);
    const singles = lots.filter(l => l.square === null);
    for (const a of singles) for (const b of singles) {
      if (a !== b && chebyshev(a, b) === 1) assert.notEqual(a.kind, b.kind, `${login}: ${a.kind} at ${key(a)} and ${key(b)}`);
    }
  }
});

test('transforms and props stay in bounds', () => {
  const { lots } = planLots(GRID, 'tester');
  for (const l of lots) {
    const k = LOT_KIND[l.kind];
    assert.ok(k, `known kind ${l.kind}`);
    assert.ok(l.tint >= 0 && l.tint <= 3 && Number.isInteger(l.tint), 'tint 0..3');
    assert.ok(l.props.length <= 5, 'prop cap');
    for (const p of l.props) {
      assert.ok(Math.abs(p.dx) <= 1.6 && Math.abs(p.dz) <= 1.6, 'props stay on the lot');
      assert.ok(p.h > 0);
    }
    if (l.square !== null) { // quarters face the intersection, snapped and near-full size
      assert.ok(Math.abs(l.rot / (Math.PI / 2) - Math.round(l.rot / (Math.PI / 2))) < 1e-9, 'square rot snaps to 90°');
      assert.ok(l.scale >= 0.95 && l.scale <= 1.0, 'square scale');
    } else if (k.organic) {
      assert.ok(l.scale >= 0.70 && l.scale <= 0.78, 'organic scale keeps the diagonal inside the lot');
    } else {
      assert.ok(Math.abs(l.rot / (Math.PI / 2) - Math.round(l.rot / (Math.PI / 2))) < 1e-9, 'man-made rot snaps to 90°');
      assert.ok(l.scale >= 0.92 && l.scale <= 1.0, 'man-made scale');
    }
  }
});

test('kind catalogue: sprites unique, fallbacks point at the classic four', () => {
  assert.equal(new Set(LOT_KINDS.map(k => k.sprite)).size, LOT_KINDS.length, 'sprite indices unique');
  assert.equal(new Set(LOT_KINDS.map(k => k.kind)).size, LOT_KINDS.length, 'kind names unique');
  for (const k of LOT_KINDS) {
    assert.ok(k.fallback >= 0 && k.fallback <= 3, `${k.kind} fallback in the classic four`);
    assert.ok(['sports', 'green', 'civic', 'utility'].includes(k.zone));
  }
});

test('zoning: stable per macro-block, singles drawn from the zone pool', () => {
  // Adjacent cells inside one 3x3 macro-block always share a zone, and the
  // zone does not depend on which other cells are vacant.
  assert.equal(zoneOf(0, 0, 'a'), zoneOf(1, 1, 'a'));
  assert.equal(zoneOf(-1, -1, 'a'), zoneOf(-2, -2, 'a'));
  const { lots } = planLots(GRID, 'tester');
  const pools = {
    sports: ['basketball', 'tennis', 'soccer', 'skate', 'track'],
    green: ['lawn', 'pond-park', 'garden', 'playground', 'dog-park'],
    civic: ['paved', 'market', 'fountain', 'amphitheater'],
    utility: ['parking', 'paved', 'lawn', 'construction'],
  };
  for (const l of lots.filter(l => l.square === null)) {
    const pool = pools[zoneOf(l.gx, l.gz, 'tester')];
    if (!pool.includes(l.kind)) { // only legal when neighbours exhausted the pool
      const neighbours = lots.filter(o => o !== l && chebyshev(o, l) === 1).map(o => o.kind);
      assert.ok(pool.every(name => neighbours.includes(name)), `${l.kind} at ${key(l)} outside an unexhausted pool`);
    }
  }
});

test('a 2x2 vacancy always becomes a square; sparse vacancy degrades gracefully', () => {
  const tiny = cellsFor([[0, 0], [1, 0], [0, 1], [1, 1]]);
  const { squares } = planLots(tiny, 'tester');
  assert.equal(squares.length, 1, 'one 2x2 block, one square');
  const scattered = cellsFor([[0, 0], [2, 2], [-2, -2], [3, -1]]);
  const degraded = planLots(scattered, 'tester');
  assert.equal(degraded.squares.length, 0, 'no 2x2 block, no squares');
  assert.equal(degraded.lots.length, 4, 'every cell still planned');
});

for (const shape of CITY_SHAPE_NAMES) {
  for (const n of [0, 1, 7, 40, 100]) {
    test(`${shape} with ${n} repos: plan is valid and near-empty cities get squares`, () => {
      const vacant = vacantFor(shape, n, 'tester');
      const { lots, squares } = planLots(vacant, 'tester');
      assert.equal(lots.length, vacant.length, 'every vacant cell planned');
      assert.equal(new Set(lots.map(key)).size, vacant.length);
      const singles = lots.filter(l => l.square === null);
      for (const a of singles) for (const b of singles) {
        if (a !== b && chebyshev(a, b) === 1) assert.notEqual(a.kind, b.kind);
      }
      for (const l of lots) {
        assert.ok(l.tint >= 0 && l.tint <= 3);
        assert.ok(l.props.length <= 5);
        for (const p of l.props) assert.ok(Math.abs(p.dx) <= 1.6 && Math.abs(p.dz) <= 1.6);
      }
      assert.ok(squares.length <= 3);
      if (n <= 1) assert.ok(squares.length >= 1, 'a near-empty city still gets a square');
      assert.equal(JSON.stringify(planLots(vacant, 'tester')), JSON.stringify({ lots, squares }), 'deterministic');
    });
  }
}
