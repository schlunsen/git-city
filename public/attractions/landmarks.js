/*
 * Git City attractions: the hilltop landmarks (radio tower, observatory,
 * hot-air balloon pad). Contract and kit: see ../attractions.js and ./kit.js.
 */

import { TAU, tools, finish, rider } from './kit.js';

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
