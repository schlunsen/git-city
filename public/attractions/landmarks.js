/*
 * Git City attractions: the hilltop landmarks (radio tower, observatory,
 * hot-air balloon pad). Contract and kit: see ../attractions.js and ./kit.js.
 */

import { TAU, tools, finish, chase, rider } from './kit.js';

// ===========================================================================
// 9. RADIO TOWER — red/white triangular lattice mast with dishes and panel
//    antennas, a blinking red beacon on top, mid-level obstruction lights and
//    an equipment hut at the foot.
// ===========================================================================
export function buildRadioTower(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'radioTower';
  const H = opts.height ?? 24, LV = 12;
  const R0 = 1.7, R1 = 0.35;
  const P = [];
  for (let k = 0; k <= LV; k++) {
    const y = (k / LV) * H, r = THREE.MathUtils.lerp(R0, R1, k / LV);
    P.push([0, 1, 2].map((j) => T.V(Math.sin((j / 3) * TAU) * r, y, Math.cos((j / 3) * TAU) * r)));
  }
  const legs = [], lattice = [], latCols = [];
  for (let j = 0; j < 3; j++) legs.push([T.V(P[0][j].x * 1.02, -1.5, P[0][j].z * 1.02), P[0][j]]);
  for (let k = 0; k < LV; k++) {
    const band = Math.floor(k / 2) % 2 ? 0xfaf3e3 : 0xe0524a;
    for (let j = 0; j < 3; j++) {
      legs.push([P[k][j], P[k + 1][j]]);
      lattice.push([P[k + 1][j], P[k + 1][(j + 1) % 3]]); latCols.push(band);
      lattice.push(k % 2 ? [P[k][j], P[k + 1][(j + 1) % 3]] : [P[k][(j + 1) % 3], P[k + 1][j]]); latCols.push(band);
    }
  }
  const legCols = legs.map((s) => (Math.floor(Math.max(0, s[0].y) / (H / LV) / 2) % 2 ? 0xfaf3e3 : 0xe0524a));
  T.beams(group, legs, 0.13, T.mat(0xffffff), { radial: 5, inkT: 0.07, colors: legCols });
  T.beams(group, lattice, 0.06, T.mat(0xffffff), { radial: 4, colors: latCols });
  // footing
  T.inked(group, T.box(4.4, 1.9, 4.4), T.mat(0xb9b1a2), 0, -0.6, 0, 0.2);
  // mast, beacon, obstruction lights
  T.add(group, T.cyl(0.08, 0.14, 3.4, 6), T.mat(0xe0524a), 0, H + 1.7, 0);
  const beacon = T.glow(0xff3b30, 2.4), mid = T.glow(0xff3b30, 1.5);
  T.inked(group, T.ball(0.32, 8, 6), beacon, 0, H + 3.5, 0, 0.08).castShadow = false;
  for (let j = 0; j < 3; j++) {
    const p = P[6][j];
    T.add(group, T.ball(0.18, 6, 4), mid, p.x * 1.15, p.y, p.z * 1.15).castShadow = false;
  }
  // dishes + panel antennas
  const dishM = T.mat(0xeef0f4), metal = T.mat(0x8b93a5);
  for (const [k, j, s] of [[8, 0, 0.75], [10, 1, 0.6], [7, 2, 0.55]]) {
    const p = P[k][j];
    const d = new THREE.Group();
    d.position.set(p.x * 1.4, p.y, p.z * 1.4);
    d.rotation.y = (j / 3) * TAU;
    group.add(d);
    const dish = T.inked(d, new THREE.CylinderGeometry(s, s * 0.7, 0.35, 12), dishM, 0, 0, 0.1, 0.1);
    dish.rotation.x = Math.PI / 2;
    T.add(d, T.box(0.12, 0.12, 0.5), metal, 0, 0, -0.2);
  }
  for (let j = 0; j < 3; j++) {
    const p = P[11][j];
    const pa = T.inked(group, T.box(0.35, 1.3, 0.14), dishM, p.x * 1.5, p.y - 0.3, p.z * 1.5, 0.08);
    pa.rotation.y = (j / 3) * TAU;
  }
  // equipment hut
  const hut = new THREE.Group();
  hut.position.set(3.6, 0, 0.6);
  hut.rotation.y = -0.2 + rnd() * 0.4;
  group.add(hut);
  T.inked(hut, T.box(2.6, 3.6, 2.2), T.mat(0xdfe3ec), 0, 0.3, 0, 0.2);
  T.inked(hut, T.box(3.0, 0.3, 2.6), T.mat(0x64dedb), 0, 2.25, 0, 0.14);
  T.add(hut, T.box(0.9, 1.6, 0.1), T.mat(0x3a4152), -0.5, 0.85, 1.12);
  T.inked(hut, T.box(0.8, 0.6, 0.6), T.mat(0xc3c9d6), 0.8, 0.9, 1.3, 0.1);
  const hutLamp = T.glow(0xfff1b0, 1.2);
  T.add(hut, T.box(0.3, 0.2, 0.2), hutLamp, -0.5, 1.85, 1.2).castShadow = false;

  const off = rnd() * 2;
  function update(dt, t) {
    const u = (t + off) % 2;
    beacon.emissiveIntensity = u < 0.35 ? 3 : 0.15;
    mid.emissiveIntensity = (u > 1 && u < 1.35) ? 2.2 : 0.15;
    hutLamp.emissiveIntensity = 0.2 + 1.4 * T.night();
  }
  update(0, 0);
  return { group: finish(T, group, []), update, radius: 5 };
}

// ===========================================================================
// 10. OBSERVATORY — white drum with a teal band, a rotating dome with a glowing
//     slit, a telescope that slowly nods and a spinning anemometer mast.
// ===========================================================================
export function buildObservatory(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'observatory';
  const R = 3.2, DRUM = 3.4, Y0 = 0.35;
  const accent = opts.color ?? T.pick([0x64dedb, 0x8c78ff, 0x3abeff]);

  T.inked(group, T.cyl(R + 0.7, R + 0.9, 1.9, 20), T.mat(0xb9b1a2), 0, -0.6, 0, 0.2);
  T.inked(group, T.cyl(R, R, DRUM, 20), T.mat(0xf3ead7), 0, Y0 + DRUM / 2, 0, 0.24);
  T.add(group, T.cyl(R + 0.08, R + 0.08, 0.4, 20), T.mat(accent), 0, Y0 + DRUM - 0.2, 0);
  // door + steps + porthole windows
  T.inked(group, T.box(1.2, 2.0, 0.4), T.mat(0x3a4152), 0, Y0 + 1.0, R - 0.1, 0.12);
  T.inked(group, T.box(1.8, 0.35, 0.9), T.mat(0xb9b1a2), 0, Y0 - 0.1, R + 0.5, 0.12);
  const winM = T.mat(0x2a2f3d), trimM = T.mat(accent);
  for (const a of [1.1, -1.1, 2.3, -2.3, Math.PI]) {
    const w = new THREE.Group();
    w.position.set(Math.sin(a) * (R + 0.02), Y0 + 2.1, Math.cos(a) * (R + 0.02));
    w.rotation.y = a;
    group.add(w);
    const ring = T.add(w, new THREE.TorusGeometry(0.34, 0.08, 4, 12), trimM, 0, 0, 0.02); ring.castShadow = false;
    T.add(w, new THREE.CircleGeometry(0.32, 12), winM, 0, 0, 0.03).castShadow = false;
  }

  // Rotating dome with a glowing slit + shutter rails, and the telescope.
  const dome = new THREE.Group();
  dome.position.y = Y0 + DRUM;
  group.add(dome);
  T.inked(dome, new THREE.SphereGeometry(R + 0.05, 20, 10, 0, TAU, 0, Math.PI / 2), T.mat(0xdfe3ec), 0, 0, 0, 0.26);
  const slitM = T.mat(0x1d2230, { emissive: 0x4a3f8e, emissiveIntensity: 0.6 });
  const W = 0.24;
  T.add(dome, new THREE.SphereGeometry(R + 0.1, 3, 10, Math.PI / 2 - W, W * 2, 0, Math.PI / 2), slitM, 0, 0, 0).castShadow = false;
  for (const s of [-1, 1]) {
    T.add(dome, new THREE.SphereGeometry(R + 0.13, 1, 10, Math.PI / 2 + s * (W + 0.03) - 0.04, 0.08, 0, Math.PI / 2), T.mat(accent), 0, 0, 0).castShadow = false;
  }
  T.inked(dome, T.ball(0.3, 8, 6), T.mat(accent), 0, R + 0.2, 0, 0.1);
  const tilt = new THREE.Group();
  tilt.position.set(0, 0.9, 0);
  dome.add(tilt);
  const tubeG = new THREE.CylinderGeometry(0.42, 0.34, 4.6, 10).translate(0, 1.9, 0);
  T.inked(tilt, tubeG, T.mat(0x2f6f7a), 0, 0, 0, 0.14);
  T.add(tilt, new THREE.CylinderGeometry(0.47, 0.47, 0.3, 10).translate(0, 3.9, 0), T.mat(accent), 0, 0, 0);

  // Anemometer mast.
  const mast = new THREE.Group();
  mast.position.set(R + 1.6, 0, -1.8);
  group.add(mast);
  T.inked(mast, T.cyl(0.07, 0.09, 6.6, 5), T.mat(0x8b93a5), 0, 1.8, 0, 0.06);
  const cups = new THREE.Group();
  cups.position.y = 5.2;
  mast.add(cups);
  const cupG = new THREE.SphereGeometry(0.2, 8, 4, 0, TAU, 0, Math.PI / 2).rotateZ(Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 3) * TAU;
    cups.add(arm);
    T.add(arm, T.box(0.9, 0.05, 0.05), T.mat(0x3a4152), 0.45, 0, 0);
    T.add(arm, cupG, T.mat(0xe0524a), 0.9, 0, 0);
  }

  const ph = rnd() * 10;
  function update(dt, t) {
    dome.rotation.y = Math.sin((t + ph) * 0.07) * 1.4 + Math.sin((t + ph) * 0.19) * 0.25;
    tilt.rotation.x = 0.55 + Math.sin((t + ph) * 0.13) * 0.22; // leaning toward +Z (out of the slit)
    cups.rotation.y -= dt * 4.2;
    slitM.emissiveIntensity = (0.1 + 0.8 * T.night()) * (1 + Math.sin(t * 0.8) * 0.15);
  }
  update(0, 0);
  return { group: finish(T, group, [dome, tilt, cups]), update, radius: 5.5 };
}

// ===========================================================================
// 11. HOT-AIR BALLOON PAD — a striped balloon tethered over a launch pad,
//     bobbing on four ropes; the burner flares in bursts. Plus a wind sock.
// ===========================================================================
export function buildBalloonPad(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'balloonPad';
  const sets = [[0xef6f6c, 0xf4d35e], [0x64dedb, 0xfaf3e3], [0x8c78ff, 0xf4d35e], [0x3abeff, 0xffa03a]];
  const [g1, g2] = opts.colors ?? T.pick(sets);

  T.inked(group, T.cyl(4.2, 4.4, 1.9, 24), T.mat(0xd8c09a), 0, -0.6, 0, 0.2);
  T.add(group, new THREE.RingGeometry(2.3, 2.9, 28).rotateX(-Math.PI / 2), T.mat(0xfaf3e3), 0, 0.37, 0).castShadow = false;
  T.add(group, new THREE.CircleGeometry(0.7, 16).rotateX(-Math.PI / 2), T.mat(g1), 0, 0.37, 0).castShadow = false;

  // Balloon: lathe teardrop with vertical gores and a cream belt.
  const balloon = new THREE.Group();
  group.add(balloon);
  const prof = [[0.75, 0], [1.3, 0.8], [2.2, 1.8], [2.95, 2.9], [3.35, 4.0], [3.35, 4.9], [3.0, 5.8], [2.3, 6.6], [1.3, 7.15], [0.02, 7.4]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const envG = T.paint(new THREE.LatheGeometry(prof, 16), (a, y) =>
    (y > 4.1 && y < 4.8) ? 0xfaf3e3 : (Math.floor((a / TAU) * 16 + 1e-4) % 2 ? g2 : g1));
  T.hull(T.add(balloon, envG, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }), 0, 0, 0), 0.3);
  // basket, cords, burner, passengers
  const BY = -2.7;
  T.inked(balloon, T.box(1.4, 1.0, 1.4), T.mat(0x9a6a44), 0, BY, 0, 0.14);
  T.add(balloon, T.box(1.5, 0.16, 1.5), T.mat(0x6b4a3a), 0, BY + 0.5, 0);
  const cords = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cords.push([T.V(sx * 0.65, BY + 0.5, sz * 0.65), T.V(sx * 0.62, 0.05, sz * 0.62)]);
  T.beams(balloon, cords, 0.035, T.mat(0x3a4152), { radial: 3 });
  T.add(balloon, T.cyl(0.25, 0.3, 0.4, 8), T.mat(0x8b93a5), 0, -0.6, 0);
  const flame = T.add(balloon, T.cone(0.3, 1.1, 7), T.basic(0xffb03a), 0, 0.15, 0);
  flame.castShadow = false;
  rider(T, balloon, -0.3, BY + 0.05, 0.1, rnd, true);
  rider(T, balloon, 0.32, BY + 0.05, -0.15, rnd, false);

  // Tethers: stakes on the pad, ropes re-aimed every frame (no allocation).
  const ropeG = new THREE.CylinderGeometry(0.035, 0.035, 1, 3, 1, true).translate(0, 0.5, 0);
  const ropeM = T.mat(0x3a4152), stakeM = T.mat(0x6b4a3a);
  const ropes = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const stake = T.V(sx * 2.6, 0.35, sz * 2.6);
    T.add(group, T.box(0.22, 0.6, 0.22), stakeM, stake.x, 0.55, stake.z);
    const r = T.add(group, ropeG, ropeM);
    r.castShadow = false;
    ropes.push({ r, stake, corner: T.V(sx * 0.7, BY - 0.45, sz * 0.7) });
  }
  // Wind sock on a pole at the pad edge.
  const sockPole = new THREE.Group();
  sockPole.position.set(-3.7, 0, 1.9);
  group.add(sockPole);
  T.inked(sockPole, T.cyl(0.06, 0.08, 4.4, 5), T.mat(0xdfe3ec), 0, 1.7, 0, 0.06);
  const sock = new THREE.Group();
  sock.position.y = 3.8;
  sockPole.add(sock);
  const sockG = T.paint(new THREE.CylinderGeometry(0.34, 0.18, 1.6, 8, 4, true), (a, y) => (Math.floor((y + 0.8) / 0.4) % 2 ? 0xffa03a : 0xfaf3e3))
    .rotateZ(Math.PI / 2).translate(0.9, 0, 0);
  T.add(sock, sockG, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));

  const _wp = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const ph = rnd() * 20;
  function update(dt, t) {
    const tt = t + ph;
    balloon.position.set(Math.sin(tt * 0.21) * 0.35, 6.6 + Math.sin(tt * 0.33) * 1.3 + Math.sin(tt * 1.1) * 0.1, Math.cos(tt * 0.17) * 0.3);
    balloon.rotation.set(Math.sin(tt * 0.5) * 0.03, tt * 0.05, Math.cos(tt * 0.43) * 0.03);
    balloon.updateMatrix();
    for (let i = 0; i < ropes.length; i++) {
      const rp = ropes[i];
      _wp.copy(rp.corner).applyMatrix4(balloon.matrix);
      _dir.subVectors(_wp, rp.stake);
      const len = _dir.length();
      rp.r.position.copy(rp.stake);
      rp.r.quaternion.setFromUnitVectors(_up, _dir.multiplyScalar(1 / len));
      rp.r.scale.set(1, len, 1);
    }
    const burst = (tt % 5.5) < 1.1;
    flame.visible = burst;
    if (burst) flame.scale.set(1, 0.8 + Math.sin(t * 30) * 0.25, 1);
    sock.rotation.y = 0.6 + Math.sin(t * 0.6) * 0.5;
    sock.rotation.z = -0.15 + Math.sin(t * 2.1) * 0.08;
  }
  update(0, 0);
  return { group: finish(T, group, [balloon, flame, sock, ...ropes.map((r) => r.r)]), update, radius: 5.5 };
}

// ===========================================================================
// 12. LIGHTHOUSE — a striped tower on a rocky headland: the lamp glows at
//     night, a beam sweeps the water, and gulls circle the top.
// ===========================================================================
export function buildLighthouse(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'lighthouse';
  const accent = opts.color ?? T.pick([0xef6f6c, 0x3abeff, 0x8c78ff]);
  const baseR = 1.5, TH = 6.2;

  // Rocky headland footing (reaches down like every builder).
  T.inked(group, T.cone(4.6, 2.2, 9), T.mat(0x8b8f9c), 0, -0.4, 0, 0.22);
  T.add(group, T.cone(3.6, 1.4, 8), T.mat(0x9aa3b2), 0, 0.5, 0);

  // Striped tower: alternate cream / accent rings, tapering.
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const f = i / rings;
    const r = baseR * (1 - 0.42 * f);
    const h = TH / rings;
    const y = 1.1 + i * h + h / 2;
    T.inked(group, T.cyl(r * 0.94, r, h, 14), i % 2 ? T.mat(0xf6f1e4) : T.mat(accent), 0, y, 0, 0.12);
  }
  // Gallery deck + railing under the lamp room.
  const galY = 1.1 + TH;
  const deckR = baseR * 0.58 + 0.7;
  T.inked(group, T.cyl(deckR, deckR + 0.2, 0.35, 14), T.mat(0x3a4152), 0, galY + 0.15, 0, 0.1);
  const railG = new THREE.TorusGeometry(deckR, 0.06, 4, 18).rotateX(Math.PI / 2);
  T.add(group, railG, T.mat(0x2f3542), 0, galY + 0.9, 0).castShadow = false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    T.add(group, T.box(0.08, 0.55, 0.08), T.mat(0x2f3542), Math.cos(a) * deckR, galY + 0.6, Math.sin(a) * deckR);
  }

  // Lamp room: glass cylinder + glowing lantern + cap.
  const lamp = new THREE.Group();
  lamp.position.y = galY + 0.6;
  group.add(lamp);
  T.inked(lamp, T.cyl(baseR * 0.42, baseR * 0.46, 1.1, 10), T.mat(0xf6f1e4), 0, 0, 0, 0.1);
  const glassM = T.mat(0xfff3c2, { emissive: 0xffd869, emissiveIntensity: 0.9, transparent: true, opacity: 0.92 });
  const glass = T.add(lamp, T.cyl(baseR * 0.34, baseR * 0.34, 0.75, 10), glassM, 0, 0.85, 0);
  glass.castShadow = false;
  T.inked(lamp, new THREE.ConeGeometry(baseR * 0.6, 0.9, 10), T.mat(accent), 0, 1.6, 0, 0.12);
  T.inked(lamp, T.ball(0.16, 8, 6), T.mat(0xf6f1e4), 0, 2.15, 0, 0.08);

  // Sweeping beam: a translucent wedge group that rotates about the lamp.
  const beam = new THREE.Group();
  beam.position.y = galY + 0.85;
  group.add(beam);
  const beamGeo = new THREE.ConeGeometry(1.6, 7, 4, 1, true).rotateZ(-Math.PI / 2).translate(3.5, 0, 0);
  const beamM = T.basic(0xfff3c2, { transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const beamMesh = T.add(beam, beamGeo, beamM, 0, 0, 0);
  beamMesh.castShadow = false;

  // Gulls: three little v-shapes circling the top.
  const gullM = T.mat(0x2f3542);
  const gulls = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const wingG = T.box(0.5, 0.05, 0.12);
    T.add(g, wingG, gullM, -0.22, 0, 0).rotation.z = 0.5;
    T.add(g, wingG, gullM, 0.22, 0, 0).rotation.z = -0.5;
    group.add(g);
    gulls.push({ g, r: 3.2 + i * 0.9, ph: rnd() * TAU, sp: 0.5 + i * 0.18 });
  }

  const ph = rnd() * 20;
  function update(dt, t) {
    const n = T.night();
    glassM.emissiveIntensity = 0.25 + 1.7 * n;
    beamM.opacity = 0.05 + 0.3 * n;
    beam.rotation.y = (t + ph) * 0.5;
    for (const gu of gulls) {
      const a = (t + ph) * gu.sp + gu.ph;
      gu.g.position.set(Math.cos(a) * gu.r, galY + 2.6 + Math.sin(a * 2) * 0.5, Math.sin(a) * gu.r);
      gu.g.rotation.y = -a;
    }
  }
  update(0, 0);
  return { group: finish(T, group, [beam, glass, ...gulls.map((g) => g.g)]), update, radius: 5 };
}

// ===========================================================================
// 13. RECORD SHOP — the island's little arcade and record store: a marquee
//     with chasing bulbs, a gramophone sign, and crates out front.
// ===========================================================================
export function buildRecordShop(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'recordShop';
  const accent = opts.color ?? T.pick([0xef6f6c, 0xffa03a, 0x8c78ff]);
  const W = 4.4, D = 3.2, H = 3.0;

  // Foundation slab.
  T.inked(group, T.box(W + 0.8, 0.3, D + 0.8), T.mat(0xb9b1a2), 0, -0.15, 0, 0.16);

  // Storefront: dark frontage, cream walls, a big window.
  T.inked(group, T.box(W, H, 0.3), T.mat(0x3a4152), 0, H / 2, D / 2 - 0.15, 0.14); // front
  T.inked(group, T.box(0.3, H, D), T.mat(0xe8e0cf), -W / 2 + 0.15, H / 2, 0, 0.14); // left
  T.inked(group, T.box(0.3, H, D), T.mat(0xe8e0cf), W / 2 - 0.15, H / 2, 0, 0.14); // right
  T.inked(group, T.box(W, 0.3, D), T.mat(0x2f3542), 0, H + 0.15, 0, 0.16); // roof line
  // Flat roof with an AC box + antenna.
  T.inked(group, T.box(1.0, 0.6, 0.8), T.mat(0x8b93a5), -W / 4, H + 0.6, -D / 4, 0.1);
  T.add(group, T.cyl(0.03, 0.03, 1.2, 4), T.mat(0x3a4152), W / 3, H + 1.0, -D / 4);

  // Window (glowing at night) + door.
  const winM = T.mat(0x35415a, { emissive: 0xffb85c, emissiveIntensity: 0.0 });
  const win = T.add(group, T.box(2.2, 1.4, 0.06), winM, -0.7, 1.5, D / 2 + 0.02);
  win.castShadow = false;
  T.inked(group, T.box(0.08, 1.4, 0.08), T.mat(0x2f3542), -0.7 + 1.1, 1.5, D / 2 + 0.02);
  T.inked(group, T.box(1.0, 2.1, 0.1), T.mat(accent), 1.35, 1.05, D / 2 + 0.04, 0.1);
  T.add(group, T.ball(0.07, 6, 4), T.mat(0xd9c9a0), 1.05, 1.0, D / 2 + 0.12);

  // Marquee: a sign box above the door with a ring of chasing bulbs.
  const marquee = new THREE.Group();
  marquee.position.set(0, H + 0.85, D / 2 + 0.35);
  group.add(marquee);
  T.inked(marquee, T.box(W - 0.4, 0.9, 0.25), T.mat(0x2a2f3d), 0, 0, 0, 0.12);
  const bulbM1 = T.glow(0xffe9a8, 0.4), bulbM2 = T.glow(0xffe9a8, 0.4);
  const bulbG = T.ball(0.09, 6, 4);
  const nB = 8;
  for (let i = 0; i < nB; i++) {
    const x = -(W - 0.9) / 2 + i * ((W - 0.9) / (nB - 1));
    const b = T.add(marquee, bulbG, i % 2 ? bulbM1 : bulbM2, x, 0.55, 0);
    b.castShadow = false;
  }
  // Chunky block-letter sign (simple bars, no textures).
  const letterM = T.glow(0xfaf3e3, 0.9);
  const bars = [
    [-1.5, -0.35], [-1.5, 0.0], [-1.5, 0.35], [-1.15, 0.35], [-0.8, 0.35], [-0.8, -0.35],
    [-0.4, -0.35], [-0.4, 0.35], [-0.05, 0.0],
  ];
  for (const [x, y] of bars) {
    const l = T.add(marquee, T.box(0.28, 0.1, 0.06), letterM, x, y, 0.14);
    l.castShadow = false;
  }

  // Gramophone sign on a bracket to the right of the door.
  const gram = new THREE.Group();
  gram.position.set(W / 2 + 0.45, 2.2, D / 2 - 0.4);
  group.add(gram);
  T.inked(gram, T.cyl(0.05, 0.05, 1.0, 4), T.mat(0x3a4152), 0, -0.5, 0, 0.05);
  T.inked(gram, new THREE.ConeGeometry(0.55, 0.9, 10), T.mat(accent), 0, 0.25, 0.1, 0.1).rotateZ(0.4);
  T.add(gram, T.cyl(0.3, 0.3, 0.06, 12).rotateX(Math.PI / 2), T.mat(0x2a2f3d), 0, -0.15, 0.28);

  // Crates + a speaker out front.
  T.inked(group, T.box(0.9, 0.7, 0.8), T.mat(0x8a6a4a), -W / 2 + 0.9, 0.35, D / 2 + 0.9, 0.1);
  T.inked(group, T.box(0.8, 0.6, 0.7), T.mat(0x6d5238), -W / 2 + 1.9, 0.3, D / 2 + 0.7, 0.1);
  T.inked(group, T.box(0.8, 1.0, 0.6), T.mat(0x2f3542), W / 2 - 0.9, 0.5, D / 2 + 0.7, 0.1);
  T.add(group, T.ball(0.2, 8, 6), T.mat(0x8b93a5), W / 2 - 0.9, 0.5, D / 2 + 1.02);

  const ph = rnd() * 10;
  function update(dt, t) {
    chase(bulbM1, bulbM2, Math.floor((t + ph) * 3) % 2 === 0, T.night());
    winM.emissiveIntensity = 0.15 + 1.4 * T.night();
    gram.rotation.y = Math.sin((t + ph) * 0.6) * 0.12;
  }
  update(0, 0);
  return { group: finish(T, group, [marquee, gram, win]), update, radius: 6 };
}

// ===========================================================================
// 14. ROBOT MONUMENT — a friendly blocky robot on a stone plinth in the park:
//     it waves, its eyes and heart glow at night, and a little flag flutters.
// ===========================================================================
export function buildRobotMonument(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'robotMonument';
  const accent = opts.color ?? T.pick([0x64b8d8, 0x8c78ff, 0x3abeff]);
  const bodyM = T.mat(0xdfe3ec), darkM = T.mat(0x3a4152), accentM = T.mat(accent);

  // Plinth + hedges.
  T.inked(group, T.box(3.0, 1.2, 3.0), T.mat(0xb9b1a2), 0, -0.3, 0, 0.18);
  T.inked(group, T.box(2.4, 0.5, 2.4), T.mat(0xa89f8c), 0, 0.45, 0, 0.12);
  T.inked(group, T.box(2.8, 0.3, 0.8), T.mat(0x4a7a3a), 0, -0.15, 1.9, 0.1);
  T.inked(group, T.box(0.8, 0.3, 2.8), T.mat(0x4a7a3a), 1.9, -0.15, 0, 0.1);
  // Nameplate.
  const plateM = T.mat(0xd9c9a0, { emissive: 0x8a6a2a, emissiveIntensity: 0.25 });
  const plate = T.add(group, T.box(1.2, 0.3, 0.06), plateM, 0, 0.2, 1.22);
  plate.castShadow = false;

  // Robot (stands on the plinth top).
  const robot = new THREE.Group();
  robot.position.y = 0.7;
  group.add(robot);
  T.inked(robot, T.box(1.3, 1.5, 0.9), bodyM, 0, 0.75, 0, 0.14);
  const heartM = T.glow(0xffe9a8, 0.6);
  const heart = T.add(robot, T.ball(0.22, 8, 6), heartM, 0, 0.75, 0.47);
  heart.castShadow = false;
  T.inked(robot, T.box(1.0, 0.25, 0.95), accentM, 0, 1.55, 0, 0.1);
  const head = new THREE.Group();
  head.position.y = 2.05;
  robot.add(head);
  T.inked(head, T.box(1.1, 0.95, 0.95), bodyM, 0, 0, 0, 0.14);
  const eyeM = T.glow(0x8fe9ff, 0.8);
  const eyeG = T.box(0.22, 0.3, 0.08);
  const eL = T.add(head, eyeG, eyeM, -0.25, 0.05, 0.5); eL.castShadow = false;
  const eR = T.add(head, eyeG, eyeM, 0.25, 0.05, 0.5); eR.castShadow = false;
  T.add(head, T.box(0.6, 0.1, 0.06), darkM, 0, -0.25, 0.5).castShadow = false;
  T.add(head, T.cyl(0.05, 0.05, 0.5, 4), darkM, 0, 0.7, 0);
  const tipM = T.glow(0xef5c5c, 0.8);
  const tip = T.add(head, T.ball(0.12, 6, 4), tipM, 0, 1.0, 0);
  tip.castShadow = false;
  // Arms: left rests, right waves.
  T.inked(robot, T.box(0.34, 0.9, 0.34), bodyM, -0.85, 0.85, 0, 0.1);
  T.inked(robot, T.ball(0.2, 6, 4), accentM, -0.85, 0.35, 0, 0.08);
  const armR = new THREE.Group();
  armR.position.set(0.85, 1.2, 0);
  robot.add(armR);
  T.inked(armR, T.box(0.34, 0.9, 0.34), bodyM, 0, -0.4, 0, 0.1);
  T.inked(armR, T.ball(0.2, 6, 4), accentM, 0, -0.9, 0, 0.08);
  // Legs.
  T.inked(robot, T.box(0.4, 0.5, 0.45), darkM, -0.3, -0.25, 0, 0.08);
  T.inked(robot, T.box(0.4, 0.5, 0.45), darkM, 0.3, -0.25, 0, 0.08);

  // Flag on a pole beside the plinth.
  const flagPole = new THREE.Group();
  flagPole.position.set(-2.2, 0, -1.4);
  group.add(flagPole);
  T.inked(flagPole, T.cyl(0.05, 0.06, 3.2, 5), T.mat(0x8b93a5), 0, 1.6, 0, 0.05);
  const flag = T.add(flagPole, T.box(0.9, 0.55, 0.05), accentM, 0.5, 2.8, 0);
  flag.castShadow = false;

  const ph = rnd() * 10;
  function update(dt, t) {
    const n = T.night();
    armR.rotation.z = 2.1 + Math.sin((t + ph) * 2.2) * 0.5; // wave
    head.rotation.y = Math.sin((t + ph) * 0.4) * 0.3;
    eyeM.emissiveIntensity = 0.4 + 1.4 * n;
    tipM.emissiveIntensity = 0.5 + 1.5 * n * (Math.sin((t + ph) * 3) > 0 ? 1 : 0.2);
    heartM.emissiveIntensity = 0.3 + 1.0 * n;
    flag.rotation.y = Math.sin((t + ph) * 3) * 0.25;
  }
  update(0, 0);
  return { group: finish(T, group, [robot, head, armR, flag, heart, tip, plate]), update, radius: 5 };
}
