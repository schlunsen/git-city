import * as THREE from 'three';
import { carGroup } from './scene.js';
import { toonMat, getOutlineMat, noRaycast, box, hullOf, mergeParts, hashStr, seededRandom } from './toon.js';
import { CELL, LANE_OFFSET, STREET_W, makeCityLayout } from './layout.js';
import { cityLayout, boulevardLane } from './block.js';
import { roundedRect } from '../world.js';
import { sponsorsFor } from './sponsors.js';

// ---------------------------------------------------------------------------
// Cars — cute cel-shaded traffic (sedan, compact, taxi, pickup, van, bus) on
// the boulevard and on the ring road just outside the plaza. Each car type is
// five merged geometries built once and every material is shared by the whole
// fleet, so a city rebuild only re-creates cheap Mesh wrappers.
// ---------------------------------------------------------------------------
const CAR_PAINTS = [0xe85d5d, 0x4d9be6, 0x58c99b, 0xf39a4b, 0xa480e0, 0xf2ede2, 0xf08fb8, 0x3fc1ba];
const BUS_PAINTS = [0xf0714f, 0x3fb6c9, 0x58c99b];
const TAXI_YELLOW = 0xf6c343;
const innerRing = () => 2.5 * CELL; // street loop just outside the plaza (±22.5 at the default cell); read live: island.streets moves CELL
export let carKit = null;   // shared geometries + materials, built on first use
let carLanes = [];   // { path, dir, length, cars[] }
const _tan1 = new THREE.Vector2(), _tan2 = new THREE.Vector2(), _carPt = new THREE.Vector2();
const MAX_SHOVE = 6; // however hard you hit them, they stay out of the sea

// Side profile (x = length, y = height) with rounded corners, extruded across
// the width and centred on z.
function sideExtrude(pts, radii, width) {
  const s = new THREE.Shape(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i], [ax, ay] = pts[(i + n - 1) % n], [bx, by] = pts[(i + 1) % n];
    const r = radii[i] || 0;
    const da = Math.hypot(ax - px, ay - py), db = Math.hypot(bx - px, by - py);
    const ka = Math.min(r, da / 2) / da, kb = Math.min(r, db / 2) / db;
    const sx = px + (ax - px) * ka, sy = py + (ay - py) * ka;
    if (i === 0) s.moveTo(sx, sy); else s.lineTo(sx, sy);
    if (r > 0) s.quadraticCurveTo(px, py, px + (bx - px) * kb, py + (by - py) * kb);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -width / 2);
}

// One car type: rounded body, glass greenhouse with a painted roof and pillars,
// wheels with hub caps, bumpers, head/tail lights and an ink hull.
// Local frame: +x forward, y up from the road, centred on x and z.
function makeCarType(o) {
  const { L, W, wr, wheelX, y0, y1, rf, rb, cab } = o;
  const x0 = -L / 2, x1 = L / 2, wc = W - 0.16;
  const paint = [], fixed = [], head = [], tail = [], hull = [];
  const body = sideExtrude([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [0.08, 0.08, rf, rb], W);
  const cabin = sideExtrude([[cab.rb, y1 - 0.02], [cab.fb, y1 - 0.02], [cab.ft, cab.top], [cab.rt, cab.top]], [0, 0, 0.14, 0.12], wc);
  hull.push(hullOf(body, 0.16), hullOf(cabin, 0.14));
  paint.push(body, box(cab.ft - cab.rt + 0.1, 0.1, wc + 0.06, (cab.ft + cab.rt) / 2, cab.top - 0.02, 0)); // roof
  for (const px of cab.pillars) paint.push(box(0.12, cab.top - y1, wc + 0.03, px, (cab.top + y1) / 2, 0));
  fixed.push([cabin, 0x9ad3ea]);
  for (const x of wheelX) for (const s of [-1, 1]) {
    const z = s * (W / 2 - 0.1);
    fixed.push([new THREE.CylinderGeometry(wr, wr, 0.26, 12).rotateX(Math.PI / 2).translate(x, wr, z), 0x1d212b]);
    fixed.push([new THREE.CylinderGeometry(wr * 0.46, wr * 0.46, 0.3, 8).rotateX(Math.PI / 2).translate(x, wr, z), 0xcfd5de]);
  }
  for (const bx of [x1 + 0.01, x0 - 0.01]) fixed.push([box(0.14, 0.16, W - 0.08, bx, y0 + 0.1, 0), 0x363c4a]);
  const ly = o.lampY ?? y0 + (y1 - y0) * 0.55;
  for (const s of [-1, 1]) {
    head.push(box(0.08, 0.14, 0.26, x1 - 0.01, ly, s * (W / 2 - 0.25)));
    tail.push(box(0.08, 0.13, 0.22, x0 + 0.01, ly, s * (W / 2 - 0.22)));
  }
  o.extra?.({ paint, fixed, head, hull, x0, x1, W, wc });
  return { L, W, paint: mergeParts(paint), fixed: mergeParts(fixed, true), head: mergeParts(head), tail: mergeParts(tail), hull: mergeParts(hull) };
}

function getCarKit() {
  if (carKit) return carKit;
  const shared = m => { m.userData.shared = true; return m; };
  const sedan = { L: 2.6, W: 1.3, wr: 0.3, wheelX: [-0.85, 0.85], y0: 0.22, y1: 0.8, rf: 0.26, rb: 0.2,
    cab: { rb: -1.0, fb: 0.46, rt: -0.76, ft: 0.08, top: 1.3, pillars: [-0.32] } };
  const types = {
    sedan: makeCarType(sedan),
    taxi: makeCarType({ ...sedan, extra: ({ head, fixed }) => {
      head.push(box(0.5, 0.2, 0.34, -0.34, 1.43, 0));             // lit roof sign
      fixed.push([box(2.0, 0.09, 1.32, 0, 0.64, 0), 0x2a2f3a]);     // dark side band
    } }),
    compact: makeCarType({ L: 2.1, W: 1.22, wr: 0.28, wheelX: [-0.68, 0.68], y0: 0.2, y1: 0.72, rf: 0.3, rb: 0.24,
      cab: { rb: -0.9, fb: 0.4, rt: -0.8, ft: -0.02, top: 1.3, pillars: [-0.38] } }),
    pickup: makeCarType({ L: 2.8, W: 1.34, wr: 0.33, wheelX: [-0.92, 0.92], y0: 0.26, y1: 0.84, rf: 0.24, rb: 0.08,
      cab: { rb: -0.22, fb: 0.74, rt: -0.22, ft: 0.38, top: 1.44, pillars: [] },
      extra: ({ paint, fixed, hull, x0, W }) => {
        fixed.push([box(1.12, 0.04, W - 0.2, -0.8, 0.855, 0), 0x3a3f4c]); // open bed
        for (const s of [-1, 1]) paint.push(box(1.18, 0.18, 0.08, -0.8, 0.93, s * (W / 2 - 0.04)));
        paint.push(box(0.08, 0.18, W, x0 + 0.04, 0.93, 0));
        hull.push(hullOf(box(1.26, 0.18, W, -0.76, 0.93, 0), 0.12));
      } }),
    van: makeCarType({ L: 2.9, W: 1.4, wr: 0.32, wheelX: [-0.95, 0.98], y0: 0.25, y1: 0.85, rf: 0.3, rb: 0.12,
      cab: { rb: -1.43, fb: 1.02, rt: -1.43, ft: 0.62, top: 1.72, pillars: [] },
      extra: ({ paint, fixed, wc }) => {
        paint.push(box(1.52, 0.87, wc + 0.04, -0.69, 1.285, 0));          // cargo box behind the cab
        fixed.push([box(1.44, 0.12, wc + 0.06, -0.69, 1.2, 0), 0xf4efe4]); // livery stripe
      } }),
    bus: makeCarType({ L: 4.8, W: 1.5, wr: 0.34, wheelX: [-1.55, 1.5], y0: 0.3, y1: 1.0, rf: 0.2, rb: 0.16, lampY: 0.55,
      cab: { rb: -2.32, fb: 2.34, rt: -2.32, ft: 2.28, top: 1.74, pillars: [-1.65, -0.85, -0.05, 0.75, 1.55] },
      extra: ({ fixed, head }) => {
        fixed.push([box(4.5, 0.14, 1.52, 0, 0.62, 0), 0xf4efe4]);          // livery band
        head.push(box(0.05, 0.14, 0.9, 2.3, 1.6, 0));                      // destination sign
      } }),
  };
  // Headlight pools: a trapezoid on the road (u along the beam, v across it)
  // with a soft canvas falloff, so it reads as light rather than a decal.
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.06, -0.45, 0, 0.06, 0.45, 5, 0.06, 1.6, 5, 0.06, -1.6], 3));
  beamGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
  beamGeo.setIndex([0, 1, 2, 0, 2, 3]);
  beamGeo.userData.shared = true;
  const bc = document.createElement('canvas');
  bc.width = bc.height = 64;
  const bctx = bc.getContext('2d'), img = bctx.createImageData(64, 64);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
    const u = i / 63, v = j / 63, k = (j * 64 + i) * 4;
    const a = Math.pow(1 - u, 1.5) * Math.min(1, u * 8) * (1 - Math.pow(Math.abs(v * 2 - 1), 2.5));
    img.data.set([255, 236, 190, Math.round(a * 255)], k);
  }
  bctx.putImageData(img, 0, 0);
  const beamTex = new THREE.CanvasTexture(bc);
  beamTex.colorSpace = THREE.SRGBColorSpace;
  const paints = new Map();
  carKit = {
    types, beamGeo,
    paint: hex => paints.get(hex) || paints.set(hex, shared(toonMat({ color: hex }))).get(hex),
    fixed: shared(toonMat({ vertexColors: true })),
    head: shared(toonMat({ color: 0xfff6d8, emissive: 0xffe2a0, emissiveIntensity: 0.2 })),
    tail: shared(toonMat({ color: 0xe0443e, emissive: 0xff3b30, emissiveIntensity: 0.15 })),
    beam: shared(new THREE.MeshBasicMaterial({
      map: beamTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })),
  };
  return carKit;
}

// A sponsor's name painted on both doors. Canvas rather than geometry: it is a
// sign, it has to be legible from the pavement, and a texture costs one draw
// call per car instead of a mesh per letter. Built per sponsor and reused by
// both sides of the car.
const liveryCache = new Map();
function liveryMaterial(sponsor) {
  const key = `${sponsor.name}|${sponsor.color}|${sponsor.ink}`;
  if (liveryCache.has(key)) return liveryCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = sponsor.color; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#1a2233'; g.lineWidth = 10; g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = sponsor.ink;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let px = 74;
  const font = () => `800 ${px}px ui-rounded, "Baloo 2", "Nunito", "Trebuchet MS", system-ui, sans-serif`;
  g.font = font();
  // Shrink to fit rather than clip: a name that runs off the door is worse than
  // a small one, and the sponsor paid for the name.
  while (g.measureText(sponsor.name).width > c.width - 70 && px > 22) { px -= 3; g.font = font(); }
  g.fillText(sponsor.name, c.width / 2, c.height / 2 + 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.shared = true;
  const mat = toonMat({ map: tex });
  mat.userData.shared = true;
  liveryCache.set(key, mat);
  return mat;
}
function addLivery(car, sponsor) {
  const { len: L, wide: W, body } = car.userData;
  const w = Math.min(L * 0.52, 2.1), h = w / 4;
  const geo = new THREE.PlaneGeometry(w, h);
  for (const side of [-1, 1]) {
    const board = new THREE.Mesh(geo, liveryMaterial(sponsor));
    // Just clear of the bodywork, facing out; the far side is mirrored so the
    // lettering reads the right way round from either pavement.
    board.position.set(-L * 0.04, 0.78, side * (W / 2 + 0.012));
    board.rotation.y = side > 0 ? 0 : Math.PI;
    board.raycast = noRaycast;
    body.add(board);
  }
}

function makeCar(kind, hex) {
  const kit = getCarKit(), t = kit.types[kind];
  const paint = new THREE.Mesh(t.paint, kit.paint(hex)), fixed = new THREE.Mesh(t.fixed, kit.fixed);
  paint.castShadow = fixed.castShadow = true;
  const body = new THREE.Group(); // leans into corners; the headlight pool stays on the road
  body.add(paint, fixed, new THREE.Mesh(t.head, kit.head), new THREE.Mesh(t.tail, kit.tail), new THREE.Mesh(t.hull, getOutlineMat()));
  const beam = new THREE.Mesh(kit.beamGeo, kit.beam);
  beam.position.x = t.L / 2 - 0.1;
  const car = new THREE.Group();
  car.add(body, beam);
  car.traverse(o => { if (o.isMesh) o.raycast = noRaycast; });
  car.userData = { body, len: t.L, wide: t.W };
  return car;
}

export function buildCars(user) {
  // Cars only wrap the shared kit, so clearing them has nothing to dispose.
  carGroup.clear();
  const rnd = seededRandom(hashStr(`traffic:${user?.login || ''}`));
  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  // Sponsors, if this island has any (it is one named login, see sponsors.js).
  // They take the first cars built, which are the ones on the boulevard, where
  // the tour and the drive-mode camera actually pass them.
  const sponsors = sponsorsFor(user?.login)?.cars || [];
  let nextSponsor = 0;
  const boulevard = shuffle(['sedan', 'compact', 'taxi', 'van', 'pickup', 'bus', 'sedan', 'compact', 'taxi', 'van', 'compact', 'sedan']);
  const inner = shuffle(['compact', 'sedan', 'taxi', 'van']);
  const paints = shuffle([...CAR_PAINTS, ...CAR_PAINTS]);
  // Right-hand traffic: each loop's outer lane runs one way, its inner lane the other.
  // The boulevard lanes follow the city footprint (smooth closed curves 0.85
  // either side of its centreline); the inner loop hugs the plaza.
  const L = cityLayout || makeCityLayout('square');
  const specs = [
    { path: boulevardLane(L, LANE_OFFSET), dir: -1, kinds: boulevard.slice(0, 6), speed: 10 },
    { path: boulevardLane(L, -LANE_OFFSET), dir: 1, kinds: boulevard.slice(6), speed: 10 },
    { path: roundedRect(THREE, innerRing() + STREET_W / 4, 3.0, THREE.Path), dir: -1, kinds: inner.slice(0, 2), speed: 6.5 },
    { path: roundedRect(THREE, innerRing() - STREET_W / 4, 1.0, THREE.Path), dir: 1, kinds: inner.slice(2), speed: 6.5 },
  ];
  carLanes = specs.map(spec => {
    const path = spec.path;
    const lane = { path, dir: spec.dir, length: path.getLength(), cars: [] };
    spec.kinds.forEach((kind, k) => {
      // A sponsored car wears the sponsor's colour instead of drawing from the
      // fleet palette; taxis and buses keep theirs, since a yellow taxi that is
      // not yellow stops being a taxi.
      const sponsor = kind !== 'taxi' && kind !== 'bus' && nextSponsor < sponsors.length ? sponsors[nextSponsor++] : null;
      const hex = sponsor ? new THREE.Color(sponsor.color).getHex()
        : kind === 'taxi' ? TAXI_YELLOW
        : kind === 'bus' ? BUS_PAINTS[Math.floor(rnd() * BUS_PAINTS.length)] : paints.pop();
      const car = makeCar(kind, hex), d = car.userData;
      if (sponsor) addLivery(car, sponsor);
      d.u = (k + 0.15 + rnd() * 0.5) / spec.kinds.length;
      d.speed = spec.speed * (kind === 'bus' ? 0.8 : 0.88 + rnd() * 0.24);
      d.v = d.speed; d.roll = 0; d.yaw = null;
      // Knocked aside by the player's car (drive mode), then eased back into the lane.
      d.shove = new THREE.Vector2(); d.shoveV = new THREE.Vector2(); d.spin = 0; d.spinV = 0;
      d.hop = 0; d.hopV = 0; d.tilt = 0; d.tiltV = 0; // a knock throws them up and over
      lane.cars.push(car);
      carGroup.add(car);
    });
    return lane;
  });
  updateCars(0);
}

export function updateCars(dt) {
  const wrap = u => ((u % 1) + 1) % 1;
  for (const { path, dir, length, cars } of carLanes) {
    for (const car of cars) {
      const d = car.userData;
      // Keep a gap to the car ahead in this lane, so slow cars bunch traffic up.
      let gap = Infinity;
      for (const o of cars) {
        if (o !== car) gap = Math.min(gap, wrap((o.userData.u - d.u) * dir) * length - (o.userData.len + d.len) / 2);
      }
      // Ease off into the rounded corners: compare the heading 6 units ahead.
      path.getTangentAt(d.u, _tan1);
      path.getTangentAt(wrap(d.u + dir * 6 / length), _tan2);
      const bend = Math.min(1, Math.acos(THREE.MathUtils.clamp(_tan1.dot(_tan2), -1, 1)) / (Math.PI / 2));
      const want = d.speed * (1 - 0.4 * bend) * THREE.MathUtils.smoothstep(gap, 1.2, 7);
      d.v += (want - d.v) * Math.min(1, dt * (want < d.v ? 4 : 1.5)); // brake harder than it accelerates
      d.u = wrap(d.u + dir * d.v * dt / length);
      path.getPointAt(d.u, _carPt);
      path.getTangentAt(d.u, _tan1);
      const yaw = Math.atan2(-_tan1.y * dir, _tan1.x * dir);
      if (d.yaw === null) d.yaw = yaw;
      const dyaw = Math.atan2(Math.sin(yaw - d.yaw), Math.cos(yaw - d.yaw));
      d.yaw = yaw;
      // Cartoon suspension: the body leans out of the turn a touch.
      const lean = dt > 0 ? THREE.MathUtils.clamp(dyaw / dt * 0.045, -0.09, 0.09) : 0;
      d.roll += (lean - d.roll) * Math.min(1, dt * 6);
      // A shove from the player: slide out of the lane, spin, bounce, then recover.
      d.shove.addScaledVector(d.shoveV, dt);
      const settle = Math.exp(-2.6 * dt);
      d.shoveV.multiplyScalar(settle);
      d.shove.multiplyScalar(Math.exp(-0.7 * dt));
      d.spin += d.spinV * dt; d.spinV *= Math.exp(-1.1 * dt); d.spin *= Math.exp(-0.8 * dt);
      const far = d.shove.length();
      if (far > MAX_SHOVE) d.shove.multiplyScalar(MAX_SHOVE / far);
      d.hopV -= 26 * dt;                     // gravity
      d.hop += d.hopV * dt;
      if (d.hop <= 0) { d.hop = 0; d.hopV = d.hopV < -2.4 ? -d.hopV * 0.32 : 0; } // and a bounce on landing
      d.tilt += d.tiltV * dt; d.tiltV *= Math.exp(-3 * dt); d.tilt *= Math.exp(-2.4 * dt);
      car.position.set(_carPt.x + d.shove.x, 0.09 + d.hop, _carPt.y + d.shove.y);
      car.rotation.y = yaw + d.spin;
      d.body.rotation.x = d.roll + d.tilt * 0.5;
      d.body.rotation.z = d.tilt;
    }
  }
}

// Drive mode: the player's car is the heavy one. Anything it runs into is
// knocked aside and slewed round, while the player barely checks. Returns the
// (small) reaction to apply to the player, or null if nothing was hit.
export function bumpTrafficCars(px, pz, vx, vz, radius = 2.2) {
  let rx = 0, rz = 0, power = 0, ix = 0, iz = 0, hits = 0;
  for (const lane of carLanes) {
    for (const car of lane.cars) {
      const d = car.userData;
      const dx = car.position.x - px, dz = car.position.z - pz;
      const dist = Math.hypot(dx, dz), reach = radius + (d.len || 2.6) * 0.42;
      if (dist > reach || dist < 1e-4) continue;
      const nx = dx / dist, nz = dz / dist;
      const closing = Math.max(0, vx * nx + vz * nz); // only what we drive into
      const punch = 4.2 + closing * 3.1;
      d.shoveV.x += nx * punch;
      d.shoveV.y += nz * punch;
      d.spinV += (nx * vz - nz * vx) * 0.26 + (Math.random() - 0.5) * (1.4 + closing * 0.5); // slewed round
      d.hopV = Math.max(d.hopV, 2.2 + closing * 0.6);          // up onto two wheels and off the road
      d.tiltV += (Math.random() - 0.5) * (2.6 + closing * 0.5);
      d.v *= 0.45;                                             // knocked out of its stride
      d.shove.x += nx * (reach - dist) * 0.6; // never leave them inside us
      d.shove.y += nz * (reach - dist) * 0.6;
      rx -= nx * closing * 0.1; rz -= nz * closing * 0.1;
      if (closing > power) { power = closing; ix = car.position.x; iz = car.position.z; }
      hits++;
    }
  }
  return hits ? { x: rx, z: rz, power, hits, ix, iz } : null;
}
