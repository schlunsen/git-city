import test from 'node:test';
import assert from 'node:assert/strict';
// The browser's own layout module: pure math, so no WebGL or network is needed.
import {
  assignDistricts, worldForCell, makeCityLayout, chooseCityShape, CITY_SHAPE_NAMES, SIDEWALK, LOT_HALF, LOT_CLEAR, CELL,
  setStreetWidth, STREET_DEFAULT, STREET_RANGE, starsToFootprint,
} from '../public/city/layout.js';

const reposFor = (languages, n = 100) =>
  Array.from({ length: n }, (_, i) => ({ name: `repo-${i}`, language: languages[i % languages.length], stargazers_count: n - i }));
const footprintClear = (L, x, z) => [[-1, -1], [1, -1], [-1, 1], [1, 1]]
  .every(([sx, sz]) => L.dist(x + sx * LOT_HALF, z + sz * LOT_HALF) <= -LOT_CLEAR + 1e-9);

for (const shape of CITY_SHAPE_NAMES) {
  const L = makeCityLayout(shape, 100, 7);
  for (const languages of [['TypeScript'], ['Python', 'Go', 'Rust', 'C', 'Java', 'Ruby']]) {
    test(`${shape}: places all 100 repositories with ${languages.length} language groups`, () => {
      const repos = reposFor(languages);
      const { assignments } = assignDistricts(repos, L);
      assert.equal(assignments.length, 100);
      assert.equal(new Set(assignments.map(a => `${a.gx},${a.gz}`)).size, 100);
      for (const a of assignments) {
        assert.ok(Number.isInteger(a.gx) && Number.isInteger(a.gz), 'buildings sit at lot centers, not road boundaries');
        const { x, z } = worldForCell(a.gx, a.gz);
        assert.ok(Math.hypot(Math.max(0, Math.abs(x) - 3.2), Math.max(0, Math.abs(z) - 3.2)) > 15.3, 'footprint clears the plaza');
        assert.ok(L.cellAt(a.gx, a.gz)?.active, 'only active cells are built on');
        assert.ok(footprintClear(L, x, z), 'the largest footprint stays inside the boulevard');
      }
      assert.equal(JSON.stringify(assignments), JSON.stringify(assignDistricts(repos, L).assignments));
    });
  }

  test(`${shape}: streets, exits and outline follow the footprint`, () => {
    assert.ok(L.capacity >= 100, `capacity ${L.capacity}`);
    assert.equal(L.cols % 2, 1); assert.equal(L.rows % 2, 1);
    // Streets run on cell boundaries, so they never cross a lot.
    for (const s of L.streets) {
      const across = s.vertical ? s.x0 : s.z0;
      assert.ok(Math.abs(Math.abs(across / CELL) % 1 - 0.5) < 1e-9, 'street on a cell boundary');
      for (const end of [[s.x0, s.z0], [s.x1, s.z1]]) assert.ok(L.dist(...end) < 0.3, 'street ends inside the boulevard');
    }
    // The inner car loop (x, z = +-22.5 around the plaza) always has its streets.
    for (const p of [-22.5, 22.5]) for (const vertical of [true, false]) {
      assert.ok(L.streets.some(s => s.vertical === vertical && (vertical ? s.x0 : s.z0) === p
        && Math.min(vertical ? s.z0 : s.x0, vertical ? s.z1 : s.x1) <= -22.5 && Math.max(vertical ? s.z0 : s.x0, vertical ? s.z1 : s.x1) >= 22.5));
    }
    assert.ok(L.exits.length >= 3 && L.exits.length <= 6);
    for (const e of L.exits) {
      assert.ok(Math.abs(L.dist(e.x, e.z) - (SIDEWALK + 0.3)) < 0.05, 'exit sits on the curb');
      assert.ok(Math.abs(Math.hypot(e.nx, e.nz) - 1) < 1e-9 && e.nx * e.x + e.nz * e.z > 0, 'unit outward normal');
    }
    // Contours are closed rings around the plaza, nested by offset.
    const slab = L.contour(SIDEWALK), lane = L.contour(-0.85);
    for (let i = 0; i < slab.length; i++) assert.ok(Math.hypot(slab[i].x, slab[i].z) > Math.hypot(lane[i].x, lane[i].z));
    assert.ok(Math.max(...slab.map(p => Math.hypot(p.x, p.z))) < 80, 'the block leaves room for the island');
    assert.equal(makeCityLayout(shape, 100, 7), L, 'same inputs, same layout object');
  });
}

test('square keeps the classic block', () => {
  const L = makeCityLayout('square');
  assert.equal(L.cols, 11); assert.equal(L.rows, 11);
  const inactive = L.cells.filter(c => !c.inside).map(c => `${c.gx},${c.gz}`).sort();
  assert.equal(JSON.stringify(inactive), JSON.stringify(['-5,-5', '-5,5', '5,-5', '5,5'])); // only the rounded corners
  assert.ok(Math.abs(L.dist(56.5, 0) - SIDEWALK) < 0.05 && Math.abs(L.dist(0, -56.5) - SIDEWALK) < 0.05);
  const c = 41.5 + 15 / Math.SQRT2; // the slab's 15-unit corner radius
  assert.ok(Math.abs(L.dist(c, c) - SIDEWALK) < 0.1);
  assert.equal(L.streets.length, 20);
  for (const s of L.streets) assert.ok(Math.abs(Math.hypot(s.x1 - s.x0, s.z1 - s.z0) - 99) < 0.6, 'streets span the block');
});

test('the footprint is chosen deterministically per profile', () => {
  const seen = new Set();
  for (let seed = 0; seed < 700; seed++) {
    assert.equal(chooseCityShape(seed), chooseCityShape(seed));
    seen.add(chooseCityShape(seed));
  }
  assert.deepEqual([...seen].sort(), [...CITY_SHAPE_NAMES].sort());
  assert.equal(chooseCityShape(3, 'round'), 'round');
  assert.equal(chooseCityShape(3, 'nope'), chooseCityShape(3));
  for (const seed of [1, 99, 12345, 0xdeadbeef]) assert.ok(makeCityLayout('blob', 100, seed).capacity >= 100, `blob ${seed}`);
});

test('small profiles never get a bigger block, prolific ones never overflow it', () => {
  for (const shape of CITY_SHAPE_NAMES) {
    assert.ok(makeCityLayout(shape, 1, 7).n <= makeCityLayout(shape, 100, 7).n);
    const L = makeCityLayout(shape, 100, 7);
    assert.equal(assignDistricts(reposFor(['Go', 'Rust'], 100), L).assignments.length, 100);
  }
});

// city.json island.streets (layout.js setStreetWidth) moves the street width,
// which moves the lot and so the building on it. The city must stay the same
// size whatever it is set to: a wider footprint deactivates cells, which forces
// a larger grid, which once pushed the block out into the island's water.
test('street width: every city keeps its footprint and its buildings on their lots', () => {
  try {
    const caps = new Map();
    for (let w = STREET_RANGE[0]; w <= STREET_RANGE[1]; w++) {
      setStreetWidth(w);
      const lot = CELL - w;
      assert.ok(starsToFootprint(1e6) <= lot + 1e-9, `streets ${w}: the largest building fits its lot`);
      assert.ok(starsToFootprint(0) > 0, `streets ${w}: the smallest building is real`);
      for (const shape of CITY_SHAPE_NAMES) {
        const L = makeCityLayout(shape, 100, 7);
        assert.ok(L.capacity >= 100, `streets ${w} ${shape}: capacity ${L.capacity}`);
        // Same grid at every width: the city never grows to make room for its
        // streets. (Capacity may rise - slimmer buildings activate more of the
        // cells the grid already has - but the block itself must not.)
        const grid = `${L.cols}x${L.rows}`, was = caps.get(shape);
        if (was === undefined) caps.set(shape, grid);
        else assert.equal(grid, was, `streets ${w} ${shape}: grid grew from ${was}`);
        assert.ok(Math.max(...L.contour(SIDEWALK).map(p => Math.hypot(p.x, p.z))) < 80,
          `streets ${w} ${shape}: the block leaves room for the island`);
        for (const a of assignDistricts(reposFor(['Go']), L).assignments) {
          const { x, z } = worldForCell(a.gx, a.gz);
          assert.ok(footprintClear(L, x, z), `streets ${w} ${shape}: footprint inside the boulevard`);
        }
      }
    }
    // The same shape at two widths is two different layouts, never a cache hit.
    setStreetWidth(4); const four = makeCityLayout('square', 100, 7);
    setStreetWidth(6); assert.notEqual(makeCityLayout('square', 100, 7), four, 'street width is part of the layout key');
    setStreetWidth(4); assert.equal(makeCityLayout('square', 100, 7), four, 'and back again is the same layout');
  } finally {
    setStreetWidth(STREET_DEFAULT); // module state: leave it as the other tests expect
  }
});

test('street width is clamped to its range, and narrower streets never grow the building', () => {
  try {
    assert.equal(setStreetWidth(99), STREET_RANGE[1]);
    assert.equal(setStreetWidth(0), STREET_RANGE[0]);
    assert.equal(setStreetWidth('nonsense'), STREET_DEFAULT);
    assert.equal(setStreetWidth(undefined), STREET_DEFAULT);
    const wide = (w) => { setStreetWidth(w); return starsToFootprint(1e6); };
    assert.equal(wide(3), wide(STREET_DEFAULT), 'below the default the extra room is pavement, not building');
    assert.ok(wide(5) < wide(STREET_DEFAULT), 'above it, wider streets slim the buildings');
  } finally {
    setStreetWidth(STREET_DEFAULT);
  }
});
