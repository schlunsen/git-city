/*
 * Git City attractions: the countryside (wind turbines, windmill, farm,
 * campsite). Contract and kit: see ../attractions.js and ./kit.js.
 */

import { TAU, clamp, tools, finish } from './kit.js';

// ===========================================================================
// 5. WIND TURBINES — a loose row of three tall white turbines, all facing the
//    same wind, blades turning at slightly different speeds; red tip bands and
//    blinking aviation lights on the nacelles.
// ===========================================================================
export function buildWindTurbines(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'windTurbines';
  const white = T.mat(0xf1f3f6), grey = T.mat(0xc9ccd6), red = T.mat(0xe0524a);
  const lamp = T.glow(0xff4b3e, 2);
  const count = opts.count ?? 3;
  const wind = rnd() * TAU;

  // Tapered blade along +Y, root at the hub.
  const BL = 8.6;
  const bladeG = new THREE.BoxGeometry(0.95, BL, 0.18, 1, 4, 1).translate(0, BL / 2 + 0.35, 0);
  {
    const p = bladeG.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = THREE.MathUtils.lerp(1, 0.32, clamp((p.getY(i) - 0.35) / BL, 0, 1));
      p.setX(i, p.getX(i) * k + (1 - k) * 0.22); // taper, trailing edge straight
    }
    bladeG.computeVertexNormals();
  }
  const tipG = new THREE.BoxGeometry(0.34, 1.0, 0.22).translate(0.22 * 0.68, BL - 0.1, 0);

  const rotors = [], feet = [];
  const spots = [[-10, 2.5], [0, -3.5], [10, 1.5]];
  for (let i = 0; i < count; i++) {
    const [sx, sz] = spots[i % spots.length];
    const H = 19 + rnd() * 4;
    const t = new THREE.Group();
    t.position.set(sx + (rnd() - 0.5) * 2.5, 0, sz + (rnd() - 0.5) * 2.5);
    group.add(t);
    feet.push(t);
    T.inked(t, T.cyl(1.2, 1.4, 1.9, 10), grey, 0, -0.6, 0, 0.16);
    T.inked(t, new THREE.CylinderGeometry(0.3, 0.62, H + 1.5, 10), white, 0, (H - 1.5) / 2, 0, 0.14);
    const head = new THREE.Group();
    head.position.y = H;
    head.rotation.y = wind + (rnd() - 0.5) * 0.25;
    t.add(head);
    T.inked(head, T.box(1.0, 1.0, 2.6), white, 0, 0.35, -0.35, 0.14);
    T.add(head, T.ball(0.16, 6, 4), lamp, 0, 0.98, -1.2).castShadow = false;
    const rotor = new THREE.Group();
    rotor.position.set(0, 0.35, 1.15);
    head.add(rotor);
    const hub = T.inked(rotor, T.cone(0.52, 1.0, 10), white, 0, 0, 0.35, 0.12);
    hub.rotation.x = Math.PI / 2;
    for (let b = 0; b < 3; b++) {
      const arm = new THREE.Group();
      arm.rotation.z = (b / 3) * TAU;
      rotor.add(arm);
      const blade = T.inked(arm, bladeG, white, 0, 0, 0, 0.14);
      blade.rotation.y = 0.28;
      const tip = T.add(blade, tipG, red);
      tip.castShadow = false;
    }
    rotor.rotation.z = rnd() * TAU;
    rotors.push({ rotor, speed: 0.9 + rnd() * 0.45, ph: rnd() * 2 });
  }
  function update(dt, t) {
    for (let i = 0; i < rotors.length; i++) rotors[i].rotor.rotation.z -= rotors[i].speed * dt;
    lamp.emissiveIntensity = (t % 2) < 0.9 ? 2.4 : 0.2;
  }
  // Each turbine is its own batch root (foot at its local y = 0), so the host
  // may terrain-snap them one by one: group.userData.snap lists them.
  group.userData.snap = feet;
  return { group: finish(T, group, [...feet, ...rotors.map((r) => r.rotor)]), update, radius: 15 };
}

// ===========================================================================
// 6. WINDMILL — Dutch smock mill: octagonal tapered body, gallery with a rail,
//    a rounded cap and four lattice sails turning slowly.
// ===========================================================================
export function buildWindmill(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'windmill';
  const body = opts.color ?? T.pick([0xf3ead7, 0xf3ead7, 0xd9785a]);
  const capHex = T.pick([0x2f7f86, 0x6b4a3a, 0x3a4152]);

  T.inked(group, T.cyl(2.9, 3.2, 1.9, 8), T.mat(0xb9b1a2), 0, -0.6, 0, 0.2);
  const bodyM = T.mat(body);
  const tower = T.inked(group, T.cyl(1.6, 2.5, 7.2, 8), bodyM, 0, 3.95, 0, 0.24);
  tower.rotation.y = Math.PI / 8;
  // gallery deck + railing ring
  const woodM = T.mat(0x8a5a3c);
  T.inked(group, T.cyl(3.0, 3.0, 0.22, 16), woodM, 0, 3.0, 0, 0.14);
  const rail = T.add(group, new THREE.TorusGeometry(2.95, 0.06, 4, 24), woodM, 0, 3.75, 0);
  rail.rotation.x = Math.PI / 2;
  const posts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    posts.push([T.V(Math.sin(a) * 2.95, 3.05, Math.cos(a) * 2.95), T.V(Math.sin(a) * 2.95, 3.78, Math.cos(a) * 2.95)]);
  }
  T.beams(group, posts, 0.05, woodM, { radial: 4 });
  // door, windows
  const darkM = T.mat(0x2a2f3d), doorM = T.mat(0xe0524a), trimM = T.mat(0xfaf3e3);
  T.inked(group, T.box(1.1, 1.8, 0.3), doorM, 0, 1.2, 2.33, 0.12);
  for (const [y, a] of [[5.4, 0], [5.0, Math.PI * 0.75], [5.0, -Math.PI * 0.75], [1.6, Math.PI / 2], [1.6, -Math.PI / 2]]) {
    const r = THREE.MathUtils.lerp(2.45, 1.6, (y - 0.35) / 7.2) + 0.02;
    const w = new THREE.Group();
    w.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    w.rotation.y = a;
    group.add(w);
    T.add(w, T.box(0.78, 0.92, 0.1), trimM, 0, 0, 0).castShadow = false;
    T.add(w, T.box(0.56, 0.7, 0.1), darkM, 0, 0, 0.04).castShadow = false;
    T.add(w, T.box(0.08, 0.7, 0.12), trimM, 0, 0, 0.06).castShadow = false;
  }
  // cap
  const capG = new THREE.SphereGeometry(1.95, 12, 6, 0, TAU, 0, Math.PI / 2).scale(1, 0.85, 1.15);
  T.inked(group, capG, T.mat(capHex), 0, 7.45, 0, 0.24);
  T.inked(group, T.box(0.42, 0.42, 2.3), T.mat(capHex), 0, 7.95, 2.3, 0.12).rotation.x = -0.12;

  // Sails on a hub out in front of the cap (clear of the gallery rail).
  const rotor = new THREE.Group();
  rotor.position.set(0, 8.0, 3.45);
  rotor.rotation.x = -0.12;
  group.add(rotor);
  T.inked(rotor, T.cyl(0.35, 0.35, 0.5, 8), darkM, 0, 0, 0, 0.1).rotation.x = Math.PI / 2;
  const sailM = T.mat(0xfaf3e3), spar = T.box(0.26, 6.6, 0.26), cloth = T.box(1.35, 4.8, 0.08), bar = T.box(1.5, 0.08, 0.14);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * TAU;
    rotor.add(arm);
    T.inked(arm, spar, woodM, 0, 3.3, 0.1, 0.12);
    T.inked(arm, cloth, sailM, 0.82, 4.0, 0.1, 0.14);
    for (let k = 0; k < 4; k++) T.add(arm, bar, woodM, 0.82, 1.9 + k * 1.4, 0.18).castShadow = false;
  }
  rotor.rotation.z = rnd() * TAU;
  const speed = 0.45 + rnd() * 0.25;
  function update(dt) { rotor.rotation.z -= speed * dt; }
  return { group: finish(T, group, [rotor]), update, radius: 5 };
}

// ===========================================================================
// 7. FARM — red gambrel barn with white trim and X doors, a banded silo with a
//    teal dome, hay bales, a fenced paddock with grazing cows, pecking hens
//    and a weather vane that swings in the breeze.
// ===========================================================================
export function buildFarm(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'farm';
  const red = T.mat(opts.barnColor ?? 0xc8453b), white = T.mat(0xfaf3e3);
  const roofM = T.mat(0x55505e), darkRed = T.mat(0x9a3530);

  // --- barn (gable faces +Z) -----------------------------------------------------
  const barn = new THREE.Group();
  barn.position.set(-1.5, 0, -2.5);
  group.add(barn);
  const W = 3, WALL = 3.6, D = 8;
  const prof = [[W, WALL], [2.2, 5.4], [0, 6.4]];
  const shape = new THREE.Shape();
  shape.moveTo(-W, -1.5); shape.lineTo(W, -1.5);
  for (const [x, y] of prof) shape.lineTo(x, y);
  for (let i = prof.length - 2; i >= 0; i--) shape.lineTo(-prof[i][0], prof[i][1]);
  shape.closePath();
  T.inked(barn, new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false }).translate(0, 0, -D / 2), red, 0, 0, 0, 0.3);
  // Roof slabs along each gambrel edge, with white trim on both gable ends.
  for (let i = 0; i < prof.length - 1; i++) {
    const [ax, ay] = prof[i], [bx, by] = prof[i + 1];
    const len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
    const nx = (by - ay) / len, ny = -(bx - ax) / len;
    for (const s of [1, -1]) {
      const cx = s * ((ax + bx) / 2 + nx * 0.16), cy = (ay + by) / 2 + ny * 0.16;
      const rz = s > 0 ? ang : Math.PI - ang;
      const slab = T.inked(barn, T.box(len + 0.4, 0.3, D + 0.7), roofM, cx, cy, 0, 0.18);
      slab.rotation.z = rz;
      for (const z of [D / 2 + 0.38, -D / 2 - 0.38]) {
        const trim = T.add(barn, T.box(len + 0.42, 0.36, 0.18), white, cx, cy, z);
        trim.rotation.z = rz;
      }
    }
  }
  for (const x of [-W, W]) for (const z of [-D / 2, D / 2]) T.add(barn, T.box(0.28, WALL + 1.5, 0.28), white, x, (WALL - 1.5) / 2, z);
  // Big X door + hayloft.
  const door = new THREE.Group();
  door.position.set(0, 0, D / 2 + 0.02);
  barn.add(door);
  T.add(door, T.box(2.9, 3.0, 0.1), white, 0, 1.4, 0);
  T.add(door, T.box(2.5, 2.7, 0.12), darkRed, 0, 1.35, 0.03);
  const diag = Math.atan2(2.6, 2.4);
  for (const s of [1, -1]) T.add(door, T.box(3.4, 0.2, 0.14), white, 0, 1.35, 0.08).rotation.z = s * diag;
  T.add(door, T.box(1.4, 1.2, 0.1), white, 0, 4.6, 0);
  T.add(door, T.box(1.1, 0.9, 0.12), T.mat(0x2a2f3d), 0, 4.6, 0.03);
  // Weather vane on the ridge.
  T.add(barn, T.cyl(0.05, 0.05, 1.3, 5), T.mat(0x3a4152), 0, 7.0, 1.5);
  const vane = new THREE.Group();
  vane.position.set(0, 7.55, 1.5);
  barn.add(vane);
  T.add(vane, T.box(1.3, 0.08, 0.08), T.mat(0x3a4152), 0, 0, 0);
  T.add(vane, T.box(0.35, 0.45, 0.06), T.mat(0xf4c542), -0.55, 0.12, 0);
  T.add(vane, T.cone(0.14, 0.3, 4), T.mat(0x3a4152), 0.75, 0, 0).rotation.z = -Math.PI / 2;

  // --- silo -----------------------------------------------------------------------
  const siloG = T.paint(new THREE.CylinderGeometry(1.5, 1.5, 9, 14, 6), (a, y) => (Math.floor((y + 4.5) / 1.5) % 2 ? 0xdfe3ec : 0xc3c9d6));
  T.hull(T.add(group, siloG, T.vmat(), 4.4, 3.0, -3.4), 0.22);
  T.inked(group, new THREE.SphereGeometry(1.55, 14, 6, 0, TAU, 0, Math.PI / 2), T.mat(0x64dedb), 4.4, 7.5, -3.4, 0.22);
  const lad = [];
  for (const dx of [-0.25, 0.25]) lad.push([T.V(4.4 + dx, 0, -1.85), T.V(4.4 + dx, 7.3, -1.85)]);
  for (let k = 1; k < 12; k++) lad.push([T.V(4.15, k * 0.6, -1.85), T.V(4.65, k * 0.6, -1.85)]);
  T.beams(group, lad, 0.04, T.mat(0x3a4152), { radial: 4 });

  // --- hay: round bales + a little square-bale stack -----------------------------
  const baleG = T.paint(new THREE.CylinderGeometry(0.75, 0.75, 1.0, 12, 1), (a, y) => (Math.abs(y) > 0.45 ? 0xf3dc8a : 0xe0b54a));
  const baleM = T.vmat();
  for (const [x, z, r] of [[3.2, 3.2, 0.2], [5.0, 2.4, 1.3], [4.1, 5.0, 0.7], [6.6, 4.4, 2.2]]) {
    const b = T.inked(group, baleG, baleM, x + (rnd() - 0.5) * 0.4, 0.68, z + (rnd() - 0.5) * 0.4, 0.14);
    b.rotation.set(0, r, Math.PI / 2);
  }
  const sq = T.box(1.4, 0.7, 0.8), sqM = T.mat(0xe7c35a);
  for (const [x, y, z] of [[2.4, 0.35, 0.2], [2.4, 0.35, 1.05], [2.4, 1.05, 0.62]]) T.inked(group, sq, sqM, x, y, z, 0.12);

  // --- paddock fence ----------------------------------------------------------------
  const woodM = T.mat(0x9a6a44);
  const px0 = -11, px1 = -5.4, pz0 = -3, pz1 = 5.5;
  const rails = [], posts = [];
  const edge = (ax, az, bx, bz, gap) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 1.6));
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * (i / n), z = az + (bz - az) * (i / n);
      posts.push([T.V(x, -0.6, z), T.V(x, 1.25, z)]);
    }
    for (const y of [0.55, 1.05]) {
      if (gap) {
        rails.push([T.V(ax, y, az), T.V(ax + (bx - ax) * 0.38, y, az + (bz - az) * 0.38)]);
        rails.push([T.V(ax + (bx - ax) * 0.62, y, az + (bz - az) * 0.62), T.V(bx, y, bz)]);
      } else rails.push([T.V(ax, y, az), T.V(bx, y, bz)]);
    }
  };
  edge(px0, pz0, px1, pz0); edge(px1, pz0, px1, pz1, true); edge(px1, pz1, px0, pz1); edge(px0, pz1, px0, pz0);
  T.beams(group, posts, 0.1, woodM, { radial: 4, inkT: 0.06 });
  T.beams(group, rails, 0.06, woodM, { radial: 4, inkT: 0.05 });

  // --- cows -----------------------------------------------------------------------
  const cowWhite = T.mat(0xf7f4ee), spot = T.mat(0x2a2f3d), pink = T.mat(0xf3a6a6), horn = T.mat(0xf3ead7);
  const cows = [];
  const mkCow = (x, z, ry) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.y = ry;
    group.add(g);
    T.inked(g, T.box(1.7, 0.85, 0.85), cowWhite, 0, 1.15, 0, 0.14);
    for (const [sx, sy, sz, w, h] of [[0.25, 1.25, 0.44, 0.55, 0.42], [-0.45, 1.05, 0.44, 0.4, 0.35], [0.1, 1.2, -0.44, 0.6, 0.4], [-0.5, 1.3, -0.44, 0.35, 0.3]]) {
      T.add(g, T.box(w, h, 0.04), spot, sx, sy, sz).castShadow = false;
    }
    T.add(g, T.box(0.5, 0.04, 0.45), spot, 0.3, 1.59, 0.1).castShadow = false;
    for (const lx of [-0.62, 0.62]) for (const lz of [-0.26, 0.26]) T.add(g, T.box(0.2, 0.9, 0.2), cowWhite, lx, 0.3, lz);
    const neck = new THREE.Group();
    neck.position.set(0.8, 1.35, 0);
    g.add(neck);
    T.inked(neck, T.box(0.6, 0.55, 0.55), cowWhite, 0.32, 0, 0, 0.12);
    T.add(neck, T.box(0.22, 0.34, 0.46), pink, 0.66, -0.1, 0);
    for (const s of [-1, 1]) {
      T.add(neck, T.box(0.08, 0.22, 0.08), horn, 0.2, 0.36, s * 0.18);
      T.add(neck, T.box(0.1, 0.12, 0.26), cowWhite, 0.14, 0.18, s * 0.38);
    }
    const tail = new THREE.Group();
    tail.position.set(-0.86, 1.45, 0);
    g.add(tail);
    T.add(tail, T.box(0.07, 0.8, 0.07), cowWhite, 0, -0.4, 0);
    T.add(tail, T.box(0.14, 0.18, 0.14), spot, 0, -0.82, 0);
    cows.push({ g, neck, tail, ry, ph: rnd() * TAU });
  };
  mkCow(-8.8, 0.2, 0.6 + rnd() * 0.5);
  mkCow(-7.4, 3.6, -2.2 + rnd() * 0.5);

  // --- hens -----------------------------------------------------------------------
  const hens = [];
  const henM = T.mat(0xfdfbf5), comb = T.mat(0xe0524a), beak = T.mat(0xffa03a);
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    g.position.set(0.2 + i * 0.9 + rnd() * 0.4, 0, 4.6 + rnd() * 1.4);
    g.rotation.y = rnd() * TAU;
    group.add(g);
    T.inked(g, T.box(0.42, 0.34, 0.3), henM, 0, 0.3, 0, 0.08);
    T.add(g, T.box(0.08, 0.2, 0.08), beak, 0, 0.08, 0);
    const head = new THREE.Group();
    head.position.set(0.18, 0.44, 0);
    g.add(head);
    T.add(head, T.box(0.2, 0.22, 0.18), henM, 0.08, 0.06, 0);
    T.add(head, T.box(0.1, 0.1, 0.04), comb, 0.08, 0.22, 0);
    T.add(head, T.box(0.1, 0.06, 0.08), beak, 0.22, 0.04, 0);
    hens.push({ g, head, ph: rnd() * 10, base: g.rotation.y });
  }

  function update(dt, t) {
    for (let i = 0; i < cows.length; i++) {
      const c = cows[i];
      c.neck.rotation.z = -0.55 - 0.35 * Math.sin(t * 0.5 + c.ph) + 0.05 * Math.sin(t * 7 + c.ph);
      c.tail.rotation.x = Math.sin(t * 2.3 + c.ph) * 0.45;
      c.g.rotation.y = c.ry + Math.sin(t * 0.09 + c.ph) * 0.5;
    }
    for (let i = 0; i < hens.length; i++) {
      const h = hens[i];
      const k = (t * 1.3 + h.ph) % 3;
      h.head.rotation.z = k < 0.5 ? -Math.sin(k / 0.5 * Math.PI) * 1.1 : 0;
      h.g.rotation.y = h.base + Math.sin(t * 0.4 + h.ph) * 1.2;
    }
    vane.rotation.y = Math.sin(t * 0.23) * 1.1 + Math.sin(t * 1.7) * 0.12;
  }
  update(0, 0);
  const dyn = [vane, ...cows.flatMap((c) => [c.g, c.neck, c.tail]), ...hens.flatMap((h) => [h.g, h.head])];
  return { group: finish(T, group, dyn), update, radius: 12 };
}

// ===========================================================================
// 8. CAMPSITE — three A-frame tents round a crackling campfire (flickering
//    unlit flames, an additive ground glow, rising smoke puffs), log benches,
//    a lantern post and an upturned canoe.
// ===========================================================================
export function buildCampsite(kit, opts = {}) {
  const T = tools(kit);
  const { THREE, rnd } = T;
  const group = new THREE.Group();
  group.name = 'campsite';

  // Dome tents: two-tone gores, a darker hem and a painted-in door (+Z).
  const domeBase = new THREE.SphereGeometry(1, 16, 6, 0, TAU, 0, Math.PI / 2).scale(1.45, 1.3, 1.3);
  const tc = new THREE.Color(), wc = new THREE.Color(0xffffff);
  const tentGeo = (hex) => T.paint(domeBase.clone(), (a, y) => {
    if ((a < 0.4 || a > TAU - 0.4) && y < 0.66) return 0x1d2230;
    if (y < 0.3) return tc.setHex(hex).multiplyScalar(0.6).getHex();
    return Math.floor(a / (TAU / 8) + 1e-4) % 2 ? tc.setHex(hex).lerp(wc, 0.4).getHex() : hex;
  });
  const tentCols = [0xffa03a, 0x64dedb, 0xf4d35e, 0x8c78ff];
  const start = rnd() * TAU;
  for (let i = 0; i < 3; i++) {
    const a = start + (i / 3) * TAU + (rnd() - 0.5) * 0.4;
    const d = 3.9 + rnd() * 0.6;
    const tent = new THREE.Group();
    tent.position.set(Math.sin(a) * d, 0, Math.cos(a) * d);
    tent.rotation.y = a + Math.PI; // door (+Z) faces the fire
    group.add(tent);
    T.inked(tent, tentGeo(tentCols[(i + Math.floor(rnd() * 4)) % tentCols.length]), T.vmat(), 0, -0.25, 0, 0.18);
    T.add(tent, T.cyl(0.05, 0.05, 0.5, 4), T.mat(0x3a4152), 0, 1.4, 0);
  }

  // Campfire: stones, crossed logs, flames, glow, smoke.
  const stoneG = new THREE.DodecahedronGeometry(0.26, 0), stoneM = T.mat(0xa9a191);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const s = T.inked(group, stoneG, stoneM, Math.sin(a) * 0.95, 0.08, Math.cos(a) * 0.95, 0.08);
    s.rotation.set(rnd() * 3, rnd() * 3, 0);
  }
  const logM = T.mat(0x7a4e32), logG = T.cyl(0.13, 0.13, 1.4, 6);
  for (let i = 0; i < 3; i++) {
    const l = T.inked(group, logG, logM, 0, 0.35, 0, 0.08);
    l.rotation.set(0.9, (i / 3) * TAU, 0, 'YXZ');
  }
  const flameO = T.basic(0xff8a2a), flameI = T.basic(0xffe066);
  const outer = T.add(group, T.cone(0.5, 1.3, 7), flameO, 0, 0.75, 0); outer.castShadow = false;
  const inner = T.add(group, T.cone(0.3, 0.85, 6), flameI, 0, 0.55, 0.05); inner.castShadow = false;
  // Trampled-dirt clearing (reads by day) + additive fire glow (reads by night).
  T.add(group, new THREE.CircleGeometry(2.9, 20).rotateX(-Math.PI / 2), T.mat(0xc9a66b), 0, 0.03, 0).castShadow = false;
  const glowM = T.basic(0xff7a1a, { transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = T.add(group, new THREE.CircleGeometry(2.6, 20).rotateX(-Math.PI / 2), glowM, 0, 0.06, 0);
  glow.castShadow = glow.receiveShadow = false;
  const smokeM = T.basic(0xf4f6fa, { transparent: true, opacity: 0.7, depthWrite: false });
  const smokeDay = new THREE.Color(0xf4f6fa), smokeNight = new THREE.Color(0x4a5060);
  const puffs = [];
  for (let i = 0; i < 5; i++) {
    const p = T.add(group, T.ball(0.35, 7, 5), smokeM, 0, 1.4, 0);
    p.castShadow = p.receiveShadow = false;
    puffs.push({ p, ph: i / 5 });
  }

  // Log benches round the fire, lantern post, upturned canoe.
  const benchG = T.cyl(0.3, 0.3, 1.9, 8);
  for (let i = 0; i < 3; i++) {
    const a = start + ((i + 0.5) / 3) * TAU;
    const b = T.inked(group, benchG, logM, Math.sin(a) * 2.3, 0.22, Math.cos(a) * 2.3, 0.1);
    b.rotation.set(0, a + Math.PI / 2, Math.PI / 2, 'YXZ');
  }
  const la = start + (1 / 6) * TAU, lr = 5.6;
  const lx = Math.sin(la) * lr, lz = Math.cos(la) * lr;
  T.inked(group, T.box(0.18, 3.8, 0.18), T.mat(0x5a4a3f), lx, 0.4, lz, 0.1);
  T.add(group, T.box(0.9, 0.12, 0.12), T.mat(0x5a4a3f), lx - Math.sin(la) * 0.4, 2.2, lz - Math.cos(la) * 0.4).rotation.y = la + Math.PI / 2;
  const lampM = T.glow(0xffd36b, 1.6);
  const lamp = T.inked(group, T.box(0.32, 0.42, 0.32), lampM, lx - Math.sin(la) * 0.75, 1.85, lz - Math.cos(la) * 0.75, 0.1);
  const ca = start + (5 / 6) * TAU;
  const canoe = T.inked(group, new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, Math.PI / 2).scale(2.2, 0.45, 0.55), T.mat(0xe0524a), Math.sin(ca) * 6.2, 0, Math.cos(ca) * 6.2, 0.14);
  canoe.rotation.y = ca;

  function update(dt, t) {
    const f = 1 + Math.sin(t * 13.1) * 0.12 + Math.sin(t * 7.3 + 1.3) * 0.1;
    outer.scale.set(1 + Math.sin(t * 9.7) * 0.06, f, 1 + Math.cos(t * 8.9) * 0.06);
    outer.rotation.y = t * 1.7;
    inner.scale.set(1, 1 + Math.sin(t * 15.3 + 2) * 0.2, 1);
    const n = T.night();
    glowM.opacity = (0.05 + 0.55 * n) * (1 + (f - 1) * 1.2);
    lampM.emissiveIntensity = (0.3 + 1.5 * n) * (1 + Math.sin(t * 3.1) * 0.08);
    smokeM.color.copy(smokeDay).lerp(smokeNight, n);
    for (let i = 0; i < puffs.length; i++) {
      const u = (t * 0.22 + puffs[i].ph) % 1;
      const s = (0.45 + u * 1.5) * (u < 0.75 ? 1 : (1 - u) / 0.25);
      puffs[i].p.position.set(u * 1.3, 1.5 + u * 4.8, u * 0.4);
      puffs[i].p.scale.setScalar(Math.max(0.001, s));
    }
    lamp.rotation.z = Math.sin(t * 1.4) * 0.06;
  }
  update(0, 0);
  return { group: finish(T, group, [outer, inner, lamp, ...puffs.map((p) => p.p)]), update, radius: 7 };
}
