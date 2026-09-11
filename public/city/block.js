/*
 * The paved city block for the current footprint: slab, curbs, boulevard,
 * inner streets and lane dashes, plus the car lanes that follow the outline.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityGroup } from './scene.js';
import { envMat, noRaycast } from './toon.js';
import { SIDEWALK, PLAZA_R, makeCityLayout } from './layout.js';
import { buildPlaza } from './plaza.js';
import { buildStreetlamps } from './townlife.js';
import { disposeObject } from './util.js';

// ---------------------------------------------------------------------------
// The paved block for the current city footprint (see makeCityLayout): slab +
// inked curb, the boulevard ring with its own curb, the inner streets clipped
// to the shape, lane dashes and the streetlamps. Rebuilt only when the
// footprint changes; the plaza in the middle never does.
// ---------------------------------------------------------------------------
export let cityLayout = null;  // makeCityLayout() result for the loaded profile
let blockGroup = null;  // meshes built from cityLayout
let blockMats = null;   // env materials, made once (envPalette recolours them)

function getBlockMats() {
  if (!blockMats) {
    const keep = m => { m.userData.shared = true; return m; };
    blockMats = {
      slab: keep(envMat(0x1a2230, 0xe3dccb)),
      ink: keep(envMat(0x090c14, 0x2b3140)),
      street: keep(envMat(0x0e131c, 0x4a5468)),
      stripe: keep(envMat(0x8a6a30, 0xf5cf4f, { emissive: 0x2a1c08 })),
    };
  }
  return blockMats;
}
// A closed contour of { x, z } points as a Shape in the XY plane (y = -z), so
// rotateX(-PI/2) lays it flat the right way round.
function contourShape(pts) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z)));
  s.closePath();
  return s;
}
// Flat band between two iso-contours of the layout's distance field.
function contourBand(L, inner, outer) {
  const s = contourShape(L.contour(outer));
  s.holes.push(contourShape(L.contour(inner)));
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}
// Evenly spaced points (by arc length) around a closed contour.
function loopResample(pts, spacing) {
  const n = pts.length, cum = [0];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z)); }
  const total = cum[n], m = Math.max(8, Math.round(total / spacing)), out = [];
  for (let k = 0, i = 0; k < m; k++) {
    const s = (k / m) * total;
    while (cum[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % n], f = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
  }
  return out;
}
// A smooth closed loop through evenly spaced points (uniform Catmull-Rom).
// Points come back as Vector2(x, z), like the THREE.Path lanes it stands in for.
class LoopCurve extends THREE.Curve {
  constructor(pts) { super(); this.pts = pts; this.arcLengthDivisions = pts.length * 4; }
  getPoint(t, out = new THREE.Vector2()) {
    const P = this.pts, n = P.length, f = (((t % 1) + 1) % 1) * n, i = Math.floor(f), u = f - i, u2 = u * u, u3 = u2 * u;
    const a = P[(i + n - 1) % n], b = P[i % n], c = P[(i + 1) % n], d = P[(i + 2) % n];
    const cr = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
    return out.set(cr(a.x, b.x, c.x, d.x), cr(a.z, b.z, c.z, d.z));
  }
}
// Car lane `offset` units outside (+) or inside (-) the boulevard centreline.
export function boulevardLane(L, offset) {
  L.lanes ??= new Map();
  if (!L.lanes.has(offset)) L.lanes.set(offset, new LoopCurve(loopResample(L.contour(offset), 1.5)));
  return L.lanes.get(offset);
}
// What world.js needs to wrap the island around this footprint. Built once per
// layout: the world caches by identity.
function cityDescriptor(L) {
  L.city ??= {
    sdf: (x, z) => L.dist(x, z) - SIDEWALK, // < 0 on the paved slab
    outline: offset => { // a fresh closed Path, `offset` units outward from the slab edge
      const path = new THREE.Path();
      L.contour(SIDEWALK + offset).forEach((p, i) => (i ? path.lineTo(p.x, p.z) : path.moveTo(p.x, p.z)));
      path.closePath();
      return path;
    },
    exits: L.exits,
  };
  return L.city;
}

export function setCityLayout(L) {
  if (L === cityLayout && blockGroup) return;
  cityLayout = L;
  cityDescriptor(L);
  buildBlock(L);
  buildStreetlamps(L);
}

function buildBlock(L) {
  if (blockGroup) { cityGroup.remove(blockGroup); disposeObject(blockGroup); }
  const M = getBlockMats(), group = new THREE.Group();
  const add = (geo, mat, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y; m.raycast = noRaycast;
    group.add(m);
    return m;
  };
  const merge = parts => { const g = mergeGeometries(parts); for (const p of parts) p.dispose(); return g; };
  // The slab (top face at y = 0) with a dark curb, so the block reads as one
  // inked shape sitting on the grass.
  const slab = level => new THREE.ExtrudeGeometry(contourShape(L.contour(level)), { depth: 0.6, bevelEnabled: false }).rotateX(-Math.PI / 2);
  add(slab(SIDEWALK), M.slab, -0.6).receiveShadow = true;
  add(slab(SIDEWALK + 0.6).scale(1, 0.5 / 0.6, 1), M.ink, -0.58);
  // The boulevard follows the outline, inked with its own curb; inner streets
  // run under its edges so every junction is covered.
  add(contourBand(L, -2.0, 2.0), M.ink, 0.07);
  add(contourBand(L, -1.6, 1.6), M.street, 0.085);
  const streets = [], dashes = [];
  const dash = (x, y, z, tx, tz) => dashes.push(new THREE.BoxGeometry(0.5, 0.06, 2.2).rotateY(Math.atan2(tx, tz)).translate(x, y, z));
  for (const s of L.streets) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    streets.push(new THREE.BoxGeometry(s.vertical ? 3.2 : len, 0.08, s.vertical ? len : 3.2).translate((s.x0 + s.x1) / 2, 0.04, (s.z0 + s.z1) / 2));
    // Lane dashes on the grid's 4.5-unit rhythm, clear of the plaza and the boulevard.
    const t0 = s.vertical ? s.z0 : s.x0, t1 = s.vertical ? s.z1 : s.x1, p = s.vertical ? s.x0 : s.z0;
    for (let t = Math.ceil((t0 - 2.25) / 4.5) * 4.5 + 2.25; t < t1; t += 4.5) {
      const x = s.vertical ? p : t, z = s.vertical ? t : p;
      if (Math.hypot(x, z) < PLAZA_R || L.dist(x, z) > -2) continue;
      dash(x, 0.09, z, s.vertical ? 0 : 1, s.vertical ? 1 : 0);
    }
  }
  // Boulevard dashes on the straight and gently curved runs, not the tight corners.
  const ring = loopResample(L.contour(0), 4.5);
  ring.forEach((b, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
    const turn = Math.abs(Math.atan2((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)));
    if (turn < 4.5 / 14) dash(b.x, 0.1, b.z, c.x - a.x, c.z - a.z);
  });
  add(merge(streets), M.street, 0);
  add(merge(dashes), M.stripe, 0);
  group.userData.layout = L;
  cityGroup.add(group);
  blockGroup = group;
}

export function buildEnvironment() {
  // The ground itself (island, water, hills) is built by world.js. The paved
  // block (slab, boulevard, streets) follows each profile's footprint and is
  // laid by setCityLayout(); the classic square stands in until one loads.
  setCityLayout(makeCityLayout('square'));
  buildPlaza();
}
