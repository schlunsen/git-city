/*
 * Git City attractions: the funfair rides (roller coaster, carousel, big-top
 * circus tent, drop tower). Contract and kit: see ../attractions.js and ./kit.js.
 */

import { TAU, noRay, clamp, smooth01, tools, chase, finish, rider } from './kit.js';

// ===========================================================================
// 1. ROLLER COASTER — closed Catmull-Rom track: station, chain lift, big drop,
//    banked turns and camelback hills; a 4-car train with slope-driven speed.
// ===========================================================================
export function buildRollerCoaster(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'rollerCoaster';

  const railHex = opts.railColor ?? T.pick([0xe0524a, 0xe0524a, 0x3abeff]);
  const supportHex = 0xe9e4d8;
  const carHex = [0x64dedb, 0xf4c542];

  const ctrl = [
    [-11, 1.6, 8], [-6.5, 1.6, 8], [-2, 5.6, 8], [3, 10.4, 8], [6.6, 12.2, 7.6],
    [9.3, 9, 7], [12, 2.4, 5.2], [14.6, 3.2, 0.5], [13, 4.2, -5], [8.5, 4.6, -8],
    [3.5, 9, -8.6], [-1.5, 3, -8.6], [-6, 6.2, -8.2], [-11, 4.2, -7], [-15, 3.6, -2],
    [-14.6, 2.6, 4], [-13.2, 1.8, 7.3],
  ];
  const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(p[0], p[1], p[2])), true, 'centripetal');
  const M = 640;
  const P = curve.getSpacedPoints(M); // P[M] === P[0]
  const L = curve.getLength();
  const ds = L / M;

  // --- frames: tangent, banking from horizontal turn rate ---------------------
  const Tn = [], yaw = new Float32Array(M), turn = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const a = P[(i - 1 + M) % M], b = P[(i + 1) % M];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    Tn.push(t);
    yaw[i] = Math.atan2(t.x, t.z);
  }
  for (let i = 0; i < M; i++) {
    let d = yaw[(i + 1) % M] - yaw[(i - 1 + M) % M];
    d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
    turn[i] = d / (2 * ds);
  }
  const bank = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    let acc = 0;
    for (let k = -10; k <= 10; k++) acc += turn[(i + k + M) % M];
    bank[i] = clamp(-(acc / 21) * 3.4, -0.7, 0.7); // lean into the turn
  }
  const Y = new THREE.Vector3(0, 1, 0);
  const side = [], up = [];
  const posArr = new Float32Array(M * 3), quatArr = new Float32Array(M * 4);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), qPrev = new THREE.Quaternion();
  for (let i = 0; i < M; i++) {
    const t = Tn[i];
    const s0 = new THREE.Vector3().crossVectors(Y, t).normalize();
    const u0 = new THREE.Vector3().crossVectors(t, s0);
    const c = Math.cos(bank[i]), s = Math.sin(bank[i]);
    const sd = s0.clone().multiplyScalar(c).addScaledVector(u0, s);
    const upv = u0.clone().multiplyScalar(c).addScaledVector(s0, -s);
    side.push(sd); up.push(upv);
    q.setFromRotationMatrix(mtx.makeBasis(sd, upv, t));
    if (i > 0 && q.dot(qPrev) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    qPrev.copy(q);
    posArr.set([P[i].x, P[i].y, P[i].z], i * 3);
    quatArr.set([q.x, q.y, q.z, q.w], i * 4);
  }

  const inStation = (p) => p.z > 6 && p.x < -6.6 && p.x > -12.5;
  const onLift = (p) => p.z > 6 && p.x >= -6.6 && p.x < 6.4;

  // --- rails: two swept tubes + ink hulls, sampled every 4th frame ------------
  const STEP = 4, R = M / STEP;
  const sweep = (off, r, S) => {
    const pos = new Float32Array(R * S * 3), nrm = new Float32Array(R * S * 3), idx = [];
    for (let i = 0; i < R; i++) {
      const k = i * STEP, p = P[k], sd = side[k], upv = up[k];
      for (let j = 0; j < S; j++) {
        const ph = (j / S) * TAU, cx = Math.cos(ph), cy = Math.sin(ph);
        const nx = sd.x * cx + upv.x * cy, ny = sd.y * cx + upv.y * cy, nz = sd.z * cx + upv.z * cy;
        const o = (i * S + j) * 3;
        pos[o] = p.x + sd.x * off + nx * r; pos[o + 1] = p.y + sd.y * off + ny * r; pos[o + 2] = p.z + sd.z * off + nz * r;
        nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
      }
    }
    for (let i = 0; i < R; i++) {
      const i2 = (i + 1) % R;
      for (let j = 0; j < S; j++) {
        const j2 = (j + 1) % S;
        const a = i * S + j, b = i2 * S + j, c = i2 * S + j2, d = i * S + j2;
        idx.push(a, d, b, b, d, c); // outward-facing (so the BackSide ink hull stays behind)
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    return g;
  };
  const railMat = T.mat(railHex);
  for (const off of [-0.55, 0.55]) {
    T.add(group, sweep(off, 0.14, 6), railMat);
    const h = new THREE.Mesh(sweep(off, 0.22, 6), T.ink);
    h.raycast = noRay;
    group.add(h);
  }

  // --- ties -------------------------------------------------------------------
  const tieCount = R / 2;
  const ties = new THREE.InstancedMesh(T.box(1.45, 0.14, 0.32), T.mat(0x4a5263), tieCount);
  const _p = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < tieCount; i++) {
    const k = i * STEP * 2;
    _p.copy(P[k]).addScaledVector(up[k], -0.12);
    q.setFromRotationMatrix(mtx.makeBasis(side[k], up[k], Tn[k]));
    ties.setMatrixAt(i, mtx.compose(_p, q, _s1));
  }
  ties.raycast = noRay; ties.castShadow = true;
  group.add(ties);

  // --- supports (+ X-bracing between tall neighbours) -------------------------
  const supportSegs = [], braceSegs = [];
  let prevTop = null;
  for (let k = 0; k < M; k += 22) {
    const p = P[k];
    if (inStation(p) || p.y < 1.2) { prevTop = null; continue; }
    const top = p.clone().addScaledVector(up[k], -0.2);
    const foot = new THREE.Vector3(top.x, -1.5, top.z);
    supportSegs.push([foot, top]);
    if (prevTop && prevTop.y > 5 && top.y > 5) {
      const lo = Math.min(prevTop.y, top.y) * 0.45;
      braceSegs.push([new THREE.Vector3(prevTop.x, lo, prevTop.z), new THREE.Vector3(top.x, lo * 1.9, top.z)]);
      braceSegs.push([new THREE.Vector3(top.x, lo, top.z), new THREE.Vector3(prevTop.x, lo * 1.9, prevTop.z)]);
    }
    prevTop = top;
  }
  const supportMat = T.mat(supportHex);
  T.beams(group, supportSegs, 0.2, supportMat, { radial: 6, inkT: 0.09 });
  if (braceSegs.length) T.beams(group, braceSegs, 0.08, supportMat, { radial: 4, inkT: 0.06 });

  // --- station: plinth under the track, platform, posts and a striped roof ----
  {
    const st = new THREE.Group();
    st.position.set(-9.2, 0, 8);
    group.add(st);
    T.inked(st, T.box(6.4, 2.9, 1.5), T.mat(0xc9b79a), 0, -0.05, 0, 0.18);
    T.inked(st, T.box(6.4, 1.5, 2.2), T.mat(0xd8cdb8), 0, 0.2, 1.9, 0.18);
    const postM = T.mat(0xf2efe8);
    for (const x of [-2.9, 2.9]) for (const z of [-0.9, 2.8]) T.inked(st, T.box(0.24, 3.4, 0.24), postM, x, 2.65, z, 0.12);
    // Hip roof (4-sided cone stretched over the platform) on a white trim slab.
    T.inked(st, T.box(7.0, 0.3, 4.3), T.mat(0xfaf3e3), 0, 4.5, 0.95, 0.18);
    const roofG = new THREE.ConeGeometry(1, 2.3, 4, 1).rotateY(Math.PI / 4).scale(5.1, 1, 3.1);
    T.inked(st, roofG, T.mat(railHex === 0xe0524a ? 0x64dedb : 0xef6f6c), 0, 5.8, 0.95, 0.25);
    T.inked(st, T.ball(0.24, 8, 6), T.mat(0xf4c542), 0, 7.0, 0.95, 0.1);
    // steps up to the platform
    T.inked(st, T.box(1.4, 0.45, 0.9), T.mat(0xd8cdb8), 3.9, 0.2, 2.3, 0.14);
  }

  // --- speed profile: chain lift, station crawl, energy elsewhere -------------
  let yMax = -Infinity;
  for (const p of P) yMax = Math.max(yMax, p.y);
  const spd = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const p = P[i];
    if (onLift(p)) spd[i] = 2.6;
    else if (inStation(p)) spd[i] = 2.2;
    else spd[i] = clamp(Math.sqrt(2.25 + 2 * 5.6 * (yMax + 0.2 - p.y)), 2.4, 12);
  }
  // Low-pass the profile so brakes and the crest ease in rather than snap.
  const tmp = new Float32Array(M);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < M; i++) {
      let a = 0;
      for (let k = -6; k <= 6; k++) a += spd[(i + k + M) % M];
      tmp[i] = a / 13;
    }
    spd.set(tmp);
  }
  // Keep the chain lift truly constant-speed.
  for (let i = 0; i < M; i++) if (onLift(P[i]) && P[i].x > -5 && P[i].x < 5.5) spd[i] = 2.6;

  // --- train --------------------------------------------------------------------
  const CARS = 4, GAP = 1.75;
  const cars = [];
  const bogieM = T.mat(0x3a4152), seatM = T.mat(0x2d3444);
  for (let c = 0; c < CARS; c++) {
    const car = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = 0.55;
    car.add(body);
    const cm = T.mat(carHex[c % 2]);
    T.inked(body, T.box(1.15, 0.55, 1.45), cm, 0, 0, 0, 0.16);
    T.add(body, T.box(1.0, 0.5, 0.18), seatM, 0, 0.35, -0.55);
    T.add(body, T.box(0.9, 0.3, 0.5), bogieM, 0, -0.38, 0);
    if (c === 0) {
      const nose = T.inked(body, T.box(1.15, 0.4, 0.7), cm, 0, 0.02, 0.95, 0.16);
      nose.rotation.x = 0.35;
      T.add(body, T.ball(0.12, 8, 6), T.glow(0xfff1b0, 0.9), 0, 0.15, 1.25);
    }
    for (const x of [-0.24, 0.24]) rider(T, body, x, 0.1, 0.05, rnd, rnd() < 0.6);
    group.add(car);
    cars.push(car);
  }

  const stopS = (() => { // stop point: centre of the station
    let best = 0, bd = Infinity;
    for (let i = 0; i < M; i++) { const d = Math.abs(P[i].x + 9.2) + (P[i].z > 6 ? 0 : 99); if (d < bd) { bd = d; best = i; } }
    return best * ds;
  })();
  const st = { s: stopS + 0.5 + rnd() * L * 0.8, v: 3, dwell: 0 };
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();

  const place = (car, s) => {
    s = ((s % L) + L) % L;
    const f = (s / L) * M, i0 = Math.floor(f) % M, i1 = (i0 + 1) % M, t = f - Math.floor(f);
    const a = i0 * 3, b = i1 * 3;
    car.position.set(
      posArr[a] + (posArr[b] - posArr[a]) * t,
      posArr[a + 1] + (posArr[b + 1] - posArr[a + 1]) * t,
      posArr[a + 2] + (posArr[b + 2] - posArr[a + 2]) * t);
    q0.fromArray(quatArr, i0 * 4); q1.fromArray(quatArr, i1 * 4);
    car.quaternion.slerpQuaternions(q0, q1, t);
  };
  const profileAt = (s) => spd[Math.floor(((((s % L) + L) % L) / L) * M) % M];

  function update(dt) {
    dt = Math.min(dt, 0.1);
    if (st.dwell > 0) {
      st.dwell -= dt; st.v = 0;
    } else {
      st.v = Math.min(profileAt(st.s), st.v + 3.5 * dt);
      const before = ((st.s - stopS) % L + L) % L;
      st.s += st.v * dt;
      const after = ((st.s - stopS) % L + L) % L;
      if (after < before) { st.dwell = 2.4; st.s = stopS; }
      if (st.s > L * 4) st.s -= L * 4;
    }
    for (let c = 0; c < CARS; c++) place(cars[c], st.s - c * GAP);
  }
  update(0);

  return { group: finish(T, group, cars), update, radius: 18 };
}

// ===========================================================================
// 2. CAROUSEL — rotating deck, golden poles, bobbing blocky horses, striped
//    canopy with a scalloped valance and chasing rim bulbs.
// ===========================================================================
export function buildCarousel(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'carousel';
  const R = 4;
  const accent = opts.color ?? T.pick([0xef6f6c, 0x64dedb, 0x8c78ff]);
  const cream = 0xfaf3e3, gold = 0xf4c542;

  // Stepped plinth (reaches below ground).
  T.inked(group, T.cyl(R + 0.45, R + 0.7, 1.9, 24), T.mat(0xd8cdb8), 0, -0.6, 0, 0.2);
  const rotor = new THREE.Group();
  group.add(rotor);

  const deckG = T.paint(new THREE.CylinderGeometry(R, R, 0.4, 24), (a, y) =>
    y > 0.19 ? 0xe8d2a8 : (Math.floor((a / TAU) * 24 + 1e-4) % 2 ? accent : gold));
  T.hull(T.add(rotor, deckG, T.vmat(), 0, 0.55, 0), 0.2);

  const colG = T.paint(new THREE.CylinderGeometry(0.6, 0.6, 4.2, 12), (a, y) => (Math.floor((y + 2.1) / 0.6) % 2 ? gold : cream));
  T.hull(T.add(rotor, colG, T.vmat(), 0, 2.85, 0), 0.18);

  // Canopy: striped cone + scalloped valance + finial and pennant.
  const canopy = T.add(rotor, T.stripes(new THREE.ConeGeometry(R + 0.75, 2.3, 16, 1), 16, [accent, cream]), T.vmat(), 0, 6.1, 0);
  T.hull(canopy, 0.3);
  const val = T.add(rotor, T.paint(new THREE.CylinderGeometry(R + 0.75, R + 0.75, 0.7, 32, 1, true), (a, y, f) => {
    const s = Math.floor((a / TAU) * 32 + 1e-4);
    return s % 2 ? cream : accent;
  }), T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }), 0, 4.65, 0);
  T.hull(val, 0.2);
  T.add(rotor, T.cyl(0.09, 0.09, 1.5, 6), T.mat(gold), 0, 7.8, 0);
  T.inked(rotor, T.ball(0.3, 10, 7), T.mat(gold), 0, 7.35, 0, 0.12);
  const flag = new THREE.Group();
  flag.position.set(0, 8.4, 0);
  rotor.add(flag);
  const flagG = new THREE.BufferGeometry().setFromPoints([T.V(0, 0.3, 0), T.V(0, -0.3, 0), T.V(1.2, 0, 0)]);
  flagG.computeVertexNormals();
  T.add(flag, flagG, T.mat(accent, { side: THREE.DoubleSide }));

  // Rim bulbs — two interleaved sets so a chase animation costs two uniforms.
  const bulbA = T.glow(0xffe39a, 1.2), bulbB = T.glow(0xfff6e0, 0.4);
  const bulbG = T.ball(0.14, 6, 4);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    T.add(rotor, bulbG, i % 2 ? bulbA : bulbB, Math.sin(a) * (R + 0.8), 4.28, Math.cos(a) * (R + 0.8)).castShadow = false;
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12 + 1 / 24) * TAU;
    T.add(rotor, bulbG, i % 2 ? bulbB : bulbA, Math.sin(a) * 2.2, 6.24, Math.cos(a) * 2.2).castShadow = false;
  }

  // Poles + horses.
  const poleM = T.mat(gold);
  const horseCols = [cream, 0xb86b3c, 0x9aa6b8, 0x3a3f4c, 0xf3a6c0, cream, 0xb86b3c, 0x9aa6b8];
  const saddleM = T.mat(accent), maneM = T.mat(0xf4c542), hoofM = T.mat(0x2d3444);
  const horses = [];
  const N = 8, RP = 3.05;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const x = Math.sin(a) * RP, z = Math.cos(a) * RP;
    T.add(rotor, T.cyl(0.07, 0.07, 4.0, 6), poleM, x, 2.75, z);
    const horse = new THREE.Group();
    horse.position.set(x, 1.9, z);
    horse.rotation.y = a + Math.PI / 2; // nose along the direction of travel
    rotor.add(horse);
    const hm = T.mat(horseCols[i % horseCols.length]);
    T.inked(horse, T.box(0.5, 0.55, 1.3), hm, 0, 0, 0, 0.13);
    const neck = T.inked(horse, T.box(0.32, 0.75, 0.36), hm, 0, 0.42, 0.55, 0.12); neck.rotation.x = 0.5;
    T.inked(horse, T.box(0.32, 0.32, 0.62), hm, 0, 0.78, 0.82, 0.12);
    const mane = T.add(horse, T.box(0.12, 0.7, 0.14), maneM, 0, 0.5, 0.36); mane.rotation.x = 0.5;
    T.add(horse, T.box(0.58, 0.12, 0.55), saddleM, 0, 0.31, -0.05);
    const tail = T.add(horse, T.box(0.12, 0.55, 0.14), maneM, 0, 0.05, -0.75); tail.rotation.x = -0.6;
    for (const [lx, lz, rx] of [[-0.16, 0.48, -0.7], [0.16, 0.48, -0.9], [-0.16, -0.5, 0.7], [0.16, -0.5, 0.5]]) {
      const leg = T.add(horse, T.box(0.13, 0.7, 0.13), hoofM === null ? hm : hm, lx, -0.5, lz);
      leg.rotation.x = rx;
      leg.position.z += Math.sin(-rx) * 0.2;
    }
    if (rnd() < 0.45) rider(T, horse, 0, 0.36, -0.05, rnd, rnd() < 0.5).scale.setScalar(0.8);
    horses.push({ horse, ph: i * 1.7 });
  }

  const spin = 0.5 + rnd() * 0.15;
  function update(dt, t) {
    rotor.rotation.y += spin * dt;
    for (let i = 0; i < horses.length; i++) {
      const h = horses[i];
      h.horse.position.y = 1.95 + Math.sin(t * 2.4 + h.ph) * 0.38;
      h.horse.rotation.x = Math.cos(t * 2.4 + h.ph) * 0.08;
    }
    chase(bulbA, bulbB, Math.sin(t * 5) > 0, T.night());
    flag.rotation.y = Math.sin(t * 3.1) * 0.3;
  }
  update(0, 0);
  return { group: finish(T, group, [rotor, flag, ...horses.map((h) => h.horse)]), update, radius: 5.6 };
}

// ===========================================================================
// 3. BIG-TOP CIRCUS TENT — striped walls, a sagging striped roof, scalloped
//    valance with marquee bulbs, bunting guy-lines and waving flags.
// ===========================================================================
export function buildCircusTent(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'circusTent';
  const [c1, c2] = opts.colors ?? T.pick([[0xe0524a, 0xfaf3e3], [0xe0524a, 0xfaf3e3], [0x2fb3ae, 0xfaf0d8]]);
  const R = 6.8, WALL = 3.4, PEAK = 9.4;

  const wallG = T.stripes(new THREE.CylinderGeometry(R, R, WALL + 1.5, 24, 1, true), 24, [c1, c2]);
  T.hull(T.add(group, wallG, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }), 0, (WALL - 1.5) / 2, 0), 0.25);

  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push(new THREE.Vector2(THREE.MathUtils.lerp(R + 0.5, 0.3, t), WALL + (PEAK - WALL) * Math.pow(t, 1.8)));
  }
  const roofG = T.stripes(new THREE.LatheGeometry(prof, 24), 12, [c1, c2]);
  T.hull(T.add(group, roofG, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }), 0, 0, 0), 0.3);

  // Scalloped valance: alternating short/long tabs.
  const valG = T.paint(new THREE.CylinderGeometry(R + 0.55, R + 0.55, 0.8, 48, 1, true), (a) =>
    Math.floor((a / TAU) * 48 + 1e-4) % 2 ? c2 : c1);
  T.hull(T.add(group, valG, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }), 0, WALL - 0.1, 0), 0.2);

  const bulbA = T.glow(0xffe39a, 1.2), bulbB = T.glow(0xfff6e0, 0.4);
  const bulbG = T.ball(0.13, 6, 4);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU;
    T.add(group, bulbG, i % 2 ? bulbA : bulbB, Math.sin(a) * (R + 0.62), WALL - 0.55, Math.cos(a) * (R + 0.62)).castShadow = false;
  }

  // Entrance: dark doorway, tied-back flaps, a little striped awning.
  const door = new THREE.Group();
  door.position.set(0, 0, R - 0.05);
  group.add(door);
  T.add(door, T.box(2.2, 2.7, 0.5), T.mat(0x1d2230), 0, 1.25, 0);
  const flapM = T.mat(c2);
  for (const s of [-1, 1]) {
    const f = T.inked(door, T.box(0.5, 2.8, 0.2), flapM, s * 1.35, 1.35, 0.25, 0.12);
    f.rotation.z = s * 0.12;
  }
  const awn = T.inked(door, T.box(3.2, 0.25, 1.6), T.mat(c1), 0, 3.05, 0.6, 0.16);
  awn.rotation.x = 0.28;
  for (const s of [-1, 1]) T.inked(door, T.box(0.16, 3.2, 0.16), T.mat(0xf4c542), s * 1.5, 1.2, 1.3, 0.1);

  // Main pole + flag, plus four side poles with pennants.
  const poleM = T.mat(0xf4c542);
  T.add(group, T.cyl(0.12, 0.14, 2.6, 6), poleM, 0, PEAK + 1.1, 0);
  T.inked(group, T.ball(0.28, 8, 6), poleM, 0, PEAK + 2.45, 0, 0.1);
  const flags = [];
  const flagG = new THREE.BufferGeometry().setFromPoints([T.V(0, 0.45, 0), T.V(0, -0.45, 0), T.V(1.8, 0.05, 0)]);
  flagG.computeVertexNormals();
  const mkFlag = (x, y, z, hex, s = 1) => {
    const f = new THREE.Group();
    f.position.set(x, y, z);
    f.scale.setScalar(s);
    group.add(f);
    T.add(f, flagG, T.mat(hex, { side: THREE.DoubleSide }));
    flags.push({ f, ph: rnd() * TAU });
  };
  mkFlag(0, PEAK + 2.0, 0, c1 === 0xe0524a ? 0x64dedb : 0xe0524a, 1.1);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4 + 0.125) * TAU;
    const x = Math.sin(a) * (R + 0.2), z = Math.cos(a) * (R + 0.2);
    T.add(group, T.cyl(0.08, 0.1, WALL + 3.2, 6), poleM, x, (WALL + 3.2) / 2 - 1.3, z);
    mkFlag(x, WALL + 1.6, z, [0x64dedb, 0xf4c542, 0x8c78ff, 0x3abeff][i], 0.6);
  }

  // Bunting: 8 guy-lines from the peak to the eave, pennants in merged tris.
  const lines = [], pts = [], cols = [];
  const pc = new THREE.Color();
  const pennantHex = [0xe0524a, 0xf4c542, 0x64dedb, 0x3abeff, 0x8c78ff, 0xfaf3e3];
  const top = T.V(0, PEAK + 0.3, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const end = T.V(Math.sin(a) * (R + 0.55), WALL + 0.45, Math.cos(a) * (R + 0.55));
    lines.push([top.clone(), end]);
    const dir = end.clone().sub(top);
    const tang = T.V(Math.cos(a), 0, -Math.sin(a));
    for (let k = 1; k <= 7; k++) {
      const p = top.clone().addScaledVector(dir, k / 8);
      const p2 = top.clone().addScaledVector(dir, (k + 0.55) / 8);
      const mid = p.clone().lerp(p2, 0.5); mid.y -= 0.55;
      pts.push(p, p2.clone().addScaledVector(tang, 0.001), mid);
      pc.setHex(pennantHex[(i + k) % pennantHex.length]);
      for (let v = 0; v < 3; v++) cols.push(pc.r, pc.g, pc.b);
    }
  }
  T.beams(group, lines, 0.035, T.mat(0x2d3444), { radial: 3 });
  const bunt = new THREE.BufferGeometry().setFromPoints(pts);
  bunt.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  bunt.computeVertexNormals();
  T.add(group, bunt, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide })).castShadow = false;

  function update(dt, t) {
    for (let i = 0; i < flags.length; i++) {
      const fl = flags[i];
      fl.f.rotation.y = Math.sin(t * 2.6 + fl.ph) * 0.35 - 0.3;
      fl.f.scale.z = 1;
    }
    chase(bulbA, bulbB, Math.sin(t * 4) > 0, T.night());
  }
  update(0, 0);
  return { group: finish(T, group, flags.map((f) => f.f)), update, radius: 8.4 };
}

// ===========================================================================
// 4. DROP TOWER — striped column, crown with a beacon; a ring of outward-
//    facing seats that crawls up, hangs, free-falls and bounces on the brakes.
// ===========================================================================
export function buildDropTower(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'dropTower';
  const H = 19;
  const accent = opts.color ?? T.pick([0xef6f6c, 0x8c78ff, 0x3abeff]);

  T.inked(group, T.cyl(3.2, 3.5, 1.9, 16), T.mat(0xc9ccd6), 0, -0.6, 0, 0.2);
  T.add(group, T.cyl(3.25, 3.25, 0.25, 16), T.mat(0x64dedb), 0, 0.2, 0);
  // Nine height segments so each band is whole triangles (colour by centroid).
  const col = T.add(group, T.paint(new THREE.CylinderGeometry(0.62, 0.8, H, 10, 9), (a, y) =>
    Math.floor((y + H / 2) / (H / 9)) % 2 ? 0xfaf3e3 : accent), T.vmat(), 0, H / 2, 0);
  T.hull(col, 0.2);
  // Crown: collar, lit ring, pointed cap, blinking beacon.
  T.inked(group, T.cyl(1.35, 1.1, 1.1, 12), T.mat(0x3a4152), 0, H + 0.4, 0, 0.18);
  T.inked(group, T.cone(1.45, 1.8, 12), T.mat(accent), 0, H + 1.85, 0, 0.22);
  const beacon = T.glow(0xff4b3e, 2);
  T.add(group, T.ball(0.3, 8, 6), beacon, 0, H + 2.95, 0).castShadow = false;
  const ringA = T.glow(0xffe39a, 1.2), ringB = T.glow(0xfff6e0, 0.4);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    T.add(group, T.ball(0.12, 6, 4), i % 2 ? ringA : ringB, Math.sin(a) * 1.38, H + 0.4, Math.cos(a) * 1.38).castShadow = false;
  }

  // Carriage: collar + 8 outward-facing seats with riders.
  const car = new THREE.Group();
  group.add(car);
  T.inked(car, T.cyl(1.25, 1.25, 0.7, 12), T.mat(0x3a4152), 0, 0, 0, 0.16);
  const seatM = T.mat(accent), barM = T.mat(0xf4c542);
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Group();
    s.rotation.y = (i / 8) * TAU;
    car.add(s);
    T.inked(s, T.box(0.75, 1.15, 0.2), seatM, 0, 0.1, 1.35, 0.12);
    T.add(s, T.box(0.75, 0.14, 0.55), seatM, 0, -0.42, 1.6);
    T.add(s, T.box(0.8, 0.12, 0.12), barM, 0, 0.05, 1.95);
    rider(T, s, 0, -0.35, 1.62, rnd, rnd() < 0.5).rotation.y = 0;
  }

  const BOT = 1.1, TOP = H - 2.6, CYCLE = 15;
  const off = rnd() * CYCLE;
  function heightAt(t) {
    if (t < 2.5) return BOT;                                            // boarding
    if (t < 8.5) return BOT + (TOP - BOT) * smooth01((t - 2.5) / 6);    // slow crawl up
    if (t < 10.3) return TOP + Math.sin((t - 8.5) * 9) * 0.03;          // suspense
    if (t < 11.4) { const u = (t - 10.3) / 1.1; return TOP - (TOP - BOT - 1.2) * u * u; } // free fall
    const u = t - 11.4;                                                  // magnetic brakes
    return BOT + 1.2 * Math.exp(-u * 2.2) * Math.abs(Math.cos(u * 5));
  }
  function update(dt, t) {
    car.position.y = heightAt((t + off) % CYCLE);
    car.rotation.y += dt * 0.15;
    beacon.emissiveIntensity = (t % 1.6) < 0.25 ? 2.6 : 0.25;
    chase(ringA, ringB, Math.sin(t * 5) > 0, T.night());
  }
  update(0, 0);
  return { group: finish(T, group, [car]), update, radius: 4 };
}
