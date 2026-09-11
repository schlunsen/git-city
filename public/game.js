// ---------------------------------------------------------------------------
// game.js — "Bomb run": a toon shoot-'em-up over your own city, played from
// explore.js's fly mode.
//
// Machine gun (tracers, ~8 rounds/s) and up to three regenerating bombs wear
// buildings down in visible stages: cracks, scorch and broken windows where
// rounds land; roof props and signs fall off first; towers lose tiers top-down
// and single blocks shed height in chunks; at low HP they lean, burn from the
// windows and shed bits; at zero they crumble for a few seconds into a rubble
// pile — only then does the kill count. Kills score from the repo's stars with
// a combo for quick successive kills. Flying into a building (its current,
// damaged shape), the ground, the monument or the sea ends the run; flatten
// every repo to win. Leaving restores the city exactly: every building group
// and each of its parts is snapshotted at the start, and everything the game
// adds lives under one group that is cleared.
//
// The pure scoring / damage / staging helpers live in game-rules.js (unit-tested
// there) and are re-exported here; the stylesheet lives in game-style.js. The
// factory touches the DOM and WebGL only when called.
// ---------------------------------------------------------------------------

import {
  GAME, STAGE_LABELS, buildingHp, applyDamage, damageStage, structureAt, hpTone, bombDamage, nextCombo,
  killScore, accuracy, regenBombs, formatStars, formatTime, boxDistance, faceNormal, bestKey,
  clamp,
} from './game-rules.js';
import { injectGameStyle } from './game-style.js';

export {
  GAME, STAGE_LABELS, buildingHp, applyDamage, damageStage, structureAt, hpTone, bombDamage, nextCombo,
  killScore, accuracy, regenBombs, formatStars, formatTime, boxDistance, faceNormal, bestKey,
};

// Particle presets. glow = unlit (sparks, fire, blasts), puff = cel-shaded (smoke, dust, spray).
const FX = {
  spark: { pool: 'glow', life: 0.34, size: 0.22, c0: 0xfff7b0, c1: 0xff8a1f, rise: -16, drag: 2.5, grow: 0, ink: 0 },
  muzzle: { pool: 'glow', life: 0.08, size: 0.55, c0: 0xffffff, c1: 0xffe066, rise: 0, drag: 0, grow: 0.4, ink: 0 },
  blast: { pool: 'glow', life: 0.6, size: 2.3, c0: 0xfff3a0, c1: 0xff7a1a, rise: 2, drag: 3.2, grow: 0.7, ink: 1 },
  fire: { pool: 'glow', life: 0.75, size: 1.0, c0: 0xffd23f, c1: 0xff5a1f, rise: 3.2, drag: 1.5, grow: 0.3, ink: 1 },
  smoke: { pool: 'puff', life: 2.1, size: 1.35, c0: 0x4a4f5c, c1: 0x8c919d, rise: 2.4, drag: 1.2, grow: 0.9, ink: 1 },
  chip: { pool: 'puff', life: 0.7, size: 0.5, c0: 0xcfc6b4, c1: 0xefe8da, rise: 0.4, drag: 2.6, grow: 0.5, ink: 1 },
  dust: { pool: 'puff', life: 1.8, size: 2.0, c0: 0xd9cba8, c1: 0xefe6d0, rise: 0.7, drag: 2.2, grow: 0.9, ink: 1 },
  splash: { pool: 'puff', life: 0.9, size: 1.2, c0: 0xffffff, c1: 0x9ad3ea, rise: -9, drag: 1.1, grow: 0.3, ink: 1 },
};

export function createBombRun(THREE, deps = {}) {
  const { scene, camera } = deps;
  const reduced = !!deps.reducedMotion;
  const SEA_Y = deps.seaY ?? -1.25;
  const groundAt = deps.groundAt || (() => 0);
  const ink = deps.ink || new THREE.MeshBasicMaterial({ color: 0x0a0d16, side: THREE.BackSide });
  const noRaycast = () => {};
  const CAP = { glow: reduced ? 70 : 150, puff: reduced ? 70 : 170, debris: reduced ? 40 : 110, rubble: 480, scorch: 120,
    crack: 180, window: 160, bullets: 64, bombs: 6 };
  const amount = (n) => (reduced ? Math.max(1, Math.ceil(n * 0.45)) : n);

  // ---- state ----------------------------------------------------------------------
  let state = 'idle';       // idle | countdown | play | over
  let endKind = null, crashWhat = '', crashRepo = '', endT = 0, countT = 0, playT = 0;
  let score = 0, kills = 0, shots = 0, hits = 0, combo = 1, lastKill = -99;
  let bombs = GAME.BOMB_MAX, regenT = 0, fireT = 0, prevBomb = false, gunSide = 1, hudAt = 0, lastCount = '';
  let targets = [], falls = [], lastHit = null, lastHitAt = -1e9, aimed = null;
  let built = null;         // meshes, created on the first start
  const root = new THREE.Group();
  root.name = 'bomb-run';

  // ---- temps (no per-frame allocation) ----------------------------------------------
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q0 = new THREE.Quaternion(), _s = new THREE.Vector3();
  const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _e = new THREE.Euler();
  const _blast = new THREE.Vector3(); // explode()'s centre: damage() -> popNumber() reuses _p mid-loop
  const _ray = new THREE.Ray(), _hit = new THREE.Vector3(), _c = new THREE.Color(), _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const hexRGB = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
  for (const f of Object.values(FX)) { f.a = hexRGB(f.c0); f.b = hexRGB(f.c1); }

  // ---- meshes ---------------------------------------------------------------------------
  function decalTexture(kind) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const x = cv.getContext('2d');
    if (kind === 'window') { // a dark, jagged smashed pane with a light rim of glass
      x.fillStyle = '#0c0f16';
      x.beginPath();
      const pts = [[18, 22], [52, 14], [70, 26], [104, 16], [112, 50], [100, 74], [114, 108], [74, 112], [58, 98], [22, 110], [14, 76], [28, 56]];
      pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(200,230,240,0.85)'; x.lineWidth = 3; x.stroke();
      x.strokeStyle = 'rgba(200,230,240,0.55)'; x.lineWidth = 2;
      for (const [a, b, c, d] of [[64, 64, 30, 30], [64, 64, 100, 34], [64, 64, 96, 100], [64, 64, 30, 96]]) { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); }
    } else { // soot splash with ink cracks radiating out
      const g = x.createRadialGradient(64, 64, 4, 64, 64, 60);
      g.addColorStop(0, 'rgba(12,10,8,0.95)'); g.addColorStop(0.45, 'rgba(30,24,20,0.7)'); g.addColorStop(1, 'rgba(30,24,20,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      x.strokeStyle = 'rgba(8,8,12,0.95)'; x.lineWidth = 3; x.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.3 * Math.sin(k * 7.3);
        x.beginPath(); x.moveTo(64, 64);
        let r = 0, px = 64, py = 64;
        while (r < 58) { r += 9; const w = a + (Math.sin(r * 0.7 + k) * 0.35); px = 64 + Math.cos(w) * r; py = 64 + Math.sin(w) * r; x.lineTo(px, py); }
        x.stroke();
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function build() {
    if (built) return built;
    const owned = [];
    const own = (x) => { owned.push(x); return x; };
    const toonMat = (hex) => (deps.toon ? deps.toon(hex) : own(new THREE.MeshToonMaterial({ color: hex }))); // the city's cel ramp
    const puffGeo = own(new THREE.IcosahedronGeometry(0.5, 1));
    const glowMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const puffMat = toonMat(0xffffff);
    const pool = (name, mat) => {
      const cap = CAP[name];
      const mesh = new THREE.InstancedMesh(puffGeo, mat, cap), inkMesh = new THREE.InstancedMesh(puffGeo, ink, cap);
      for (const m of [mesh, inkMesh]) { m.frustumCulled = false; m.raycast = noRaycast; for (let i = 0; i < cap; i++) m.setMatrixAt(i, ZERO); }
      mesh.setColorAt(0, _c.set(0xffffff));
      root.add(mesh, inkMesh);
      return {
        mesh, inkMesh, cap, next: 0, active: false,
        pos: new Float32Array(cap * 3), vel: new Float32Array(cap * 3), col: new Float32Array(cap * 6),
        age: new Float32Array(cap).fill(1e9), life: new Float32Array(cap), size: new Float32Array(cap),
        rise: new Float32Array(cap), drag: new Float32Array(cap), grow: new Float32Array(cap), ink: new Uint8Array(cap),
      };
    };
    const pools = { glow: pool('glow', glowMat), puff: pool('puff', puffMat) };

    // Debris: tumbling cel-shaded chunks with ink.
    const boxGeo = own(new THREE.BoxGeometry(1, 1, 1));
    const debrisMat = toonMat(0xffffff);
    const debris = { cap: CAP.debris, next: 0, active: false,
      mesh: new THREE.InstancedMesh(boxGeo, debrisMat, CAP.debris), inkMesh: new THREE.InstancedMesh(boxGeo, ink, CAP.debris),
      pos: new Float32Array(CAP.debris * 3), vel: new Float32Array(CAP.debris * 3), rot: new Float32Array(CAP.debris * 3),
      spin: new Float32Array(CAP.debris * 3), age: new Float32Array(CAP.debris).fill(1e9), size: new Float32Array(CAP.debris) };
    for (const m of [debris.mesh, debris.inkMesh]) { m.frustumCulled = false; m.raycast = noRaycast; for (let i = 0; i < CAP.debris; i++) m.setMatrixAt(i, ZERO); }
    debris.mesh.setColorAt(0, _c.set(0xffffff));
    debris.mesh.castShadow = true;
    root.add(debris.mesh, debris.inkMesh);

    // Rubble piles and scorch marks on the lots of fallen buildings.
    const rockGeo = own(new THREE.DodecahedronGeometry(0.5, 0));
    const rubbleMat = toonMat(0xffffff);
    const rubble = { n: 0, mesh: new THREE.InstancedMesh(rockGeo, rubbleMat, CAP.rubble), inkMesh: new THREE.InstancedMesh(rockGeo, ink, CAP.rubble) };
    const scorchGeo = own(new THREE.CircleGeometry(0.5, 28).rotateX(-Math.PI / 2));
    const scorchMat = own(new THREE.MeshBasicMaterial({ color: 0x1b1612, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const scorch = { n: 0, mesh: new THREE.InstancedMesh(scorchGeo, scorchMat, CAP.scorch) };
    for (const m of [rubble.mesh, rubble.inkMesh, scorch.mesh]) { m.frustumCulled = false; m.raycast = noRaycast; m.count = 0; }
    rubble.mesh.setColorAt(0, _c.set(0xffffff));
    rubble.mesh.receiveShadow = rubble.mesh.castShadow = true;
    root.add(scorch.mesh, rubble.mesh, rubble.inkMesh);

    // Wall decals: soot + cracks where rounds land, smashed windows near them.
    const quadGeo = own(new THREE.PlaneGeometry(1, 1));
    const decalPool = (name, kind) => {
      const tex = own(decalTexture(kind));
      const mat = own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      const mesh = new THREE.InstancedMesh(quadGeo, mat, CAP[name]);
      mesh.frustumCulled = false; mesh.raycast = noRaycast;
      for (let i = 0; i < CAP[name]; i++) mesh.setMatrixAt(i, ZERO);
      root.add(mesh);
      return { mesh, cap: CAP[name], next: 0, own: new Int16Array(CAP[name]).fill(-1), tier: new Int8Array(CAP[name]),
        pos: new Float32Array(CAP[name] * 3), quat: new Float32Array(CAP[name] * 4), size: new Float32Array(CAP[name]) };
    };
    const decals = { crack: decalPool('crack', 'crack'), window: decalPool('window', 'window') };

    // Tracers.
    const bulletMat = own(new THREE.MeshBasicMaterial({ color: 0xffe36e }));
    const bullets = { cap: CAP.bullets, mesh: new THREE.InstancedMesh(boxGeo, bulletMat, CAP.bullets),
      pos: new Float32Array(CAP.bullets * 3), vel: new Float32Array(CAP.bullets * 3), age: new Float32Array(CAP.bullets).fill(1e9), active: false };
    bullets.mesh.frustumCulled = false; bullets.mesh.raycast = noRaycast;
    for (let i = 0; i < CAP.bullets; i++) bullets.mesh.setMatrixAt(i, ZERO);
    root.add(bullets.mesh);

    // Bombs: a little toon bomb with a red band and tail fins (local +x = nose).
    const bombBody = own(new THREE.CapsuleGeometry(0.28, 0.62, 4, 12).rotateZ(-Math.PI / 2));
    const bombInk = own(new THREE.CapsuleGeometry(0.36, 0.7, 4, 12).rotateZ(-Math.PI / 2));
    const bandGeo = own(new THREE.CylinderGeometry(0.295, 0.295, 0.14, 14).rotateZ(Math.PI / 2).translate(0.12, 0, 0));
    const finGeo = own(new THREE.BoxGeometry(0.26, 0.5, 0.05).translate(-0.52, 0, 0));
    const darkMat = toonMat(0x2a2f3a), redMat = toonMat(0xef5b4c);
    const bombList = [];
    for (let i = 0; i < CAP.bombs; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bombBody, darkMat), new THREE.Mesh(bombInk, ink), new THREE.Mesh(bandGeo, redMat));
      for (let k = 0; k < 2; k++) { const f = new THREE.Mesh(finGeo, darkMat); f.rotation.x = k * Math.PI / 2; g.add(f); }
      g.traverse((o) => { o.raycast = noRaycast; if (o.isMesh && o.material !== ink) o.castShadow = true; });
      g.visible = false;
      root.add(g);
      bombList.push({ g, live: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0 });
    }
    built = { owned, pools, debris, rubble, scorch, decals, bullets, bombs: bombList };
    return built;
  }

  // ---- particles ----------------------------------------------------------------------
  function emit(kind, x, y, z, vx, vy, vz, sizeMul = 1) {
    const f = FX[kind], P = built.pools[f.pool], i = P.next, i3 = i * 3, i6 = i * 6;
    P.next = (i + 1) % P.cap;
    P.pos[i3] = x; P.pos[i3 + 1] = y; P.pos[i3 + 2] = z;
    P.vel[i3] = vx; P.vel[i3 + 1] = vy; P.vel[i3 + 2] = vz;
    P.col.set(f.a, i6); P.col.set(f.b, i6 + 3);
    P.age[i] = 0; P.life[i] = f.life * (0.8 + Math.random() * 0.4); P.size[i] = f.size * sizeMul * (0.75 + Math.random() * 0.5);
    P.rise[i] = f.rise; P.drag[i] = f.drag; P.grow[i] = f.grow; P.ink[i] = f.ink;
    P.active = true;
  }
  function burst(kind, n, x, y, z, speed, sizeMul = 1, up = 0) {
    for (let k = 0, c = amount(n); k < c; k++) {
      _d.set(Math.random() - 0.5, Math.random() - 0.5 + up, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      emit(kind, x, y, z, _d.x, _d.y, _d.z, sizeMul);
    }
  }
  function stepPool(P, dt) {
    if (!P.active) return;
    let any = false;
    for (let i = 0; i < P.cap; i++) {
      if (P.age[i] >= P.life[i]) {
        if (P.life[i] > 0) { P.life[i] = 0; P.mesh.setMatrixAt(i, ZERO); P.inkMesh.setMatrixAt(i, ZERO); any = true; }
        continue;
      }
      any = true;
      P.age[i] += dt;
      const i3 = i * 3, i6 = i * 6, k = Math.min(1, P.age[i] / P.life[i]), dr = Math.exp(-P.drag[i] * dt);
      P.vel[i3] *= dr; P.vel[i3 + 1] = P.vel[i3 + 1] * dr + P.rise[i] * dt; P.vel[i3 + 2] *= dr;
      P.pos[i3] += P.vel[i3] * dt; P.pos[i3 + 1] += P.vel[i3 + 1] * dt; P.pos[i3 + 2] += P.vel[i3 + 2] * dt;
      const s = P.size[i] * (k < 0.16 ? k / 0.16 : 1 - Math.pow((k - 0.16) / 0.84, 1.6)) * (1 + P.grow[i] * k);
      _p.set(P.pos[i3], P.pos[i3 + 1], P.pos[i3 + 2]);
      P.mesh.setMatrixAt(i, _m.compose(_p, _q0, _s.setScalar(Math.max(0, s))));
      P.inkMesh.setMatrixAt(i, P.ink[i] ? _m.compose(_p, _q0, _s.setScalar(Math.max(0, s) * 1.18)) : ZERO);
      P.mesh.setColorAt(i, _c.setRGB(P.col[i6] + (P.col[i6 + 3] - P.col[i6]) * k, P.col[i6 + 1] + (P.col[i6 + 4] - P.col[i6 + 1]) * k, P.col[i6 + 2] + (P.col[i6 + 5] - P.col[i6 + 2]) * k));
    }
    P.mesh.instanceMatrix.needsUpdate = P.inkMesh.instanceMatrix.needsUpdate = true;
    if (P.mesh.instanceColor) P.mesh.instanceColor.needsUpdate = true;
    P.active = any;
  }

  // ---- debris ---------------------------------------------------------------------------
  function throwDebris(n, x, y, z, spread, colors, power = 1) {
    const D = built.debris;
    for (let k = 0, c = amount(n); k < c; k++) {
      const i = D.next, i3 = i * 3;
      D.next = (i + 1) % D.cap;
      D.pos[i3] = x + (Math.random() - 0.5) * spread; D.pos[i3 + 1] = y + Math.random() * spread * 0.5; D.pos[i3 + 2] = z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2, sp = (3 + Math.random() * 8) * power;
      D.vel[i3] = Math.cos(a) * sp; D.vel[i3 + 1] = (4 + Math.random() * 9) * power; D.vel[i3 + 2] = Math.sin(a) * sp;
      for (let j = 0; j < 3; j++) { D.rot[i3 + j] = Math.random() * 6; D.spin[i3 + j] = (Math.random() - 0.5) * 12; }
      D.age[i] = 0; D.size[i] = 0.3 + Math.random() * 0.7;
      D.mesh.setColorAt(i, _c.set(colors[k % colors.length]));
      D.active = true;
    }
    if (D.mesh.instanceColor) D.mesh.instanceColor.needsUpdate = true;
  }
  function stepDebris(dt) {
    const D = built.debris;
    if (!D.active) return;
    let any = false;
    for (let i = 0; i < D.cap; i++) {
      if (D.age[i] > 3.4) { if (D.age[i] < 1e8) { D.age[i] = 1e9; D.mesh.setMatrixAt(i, ZERO); D.inkMesh.setMatrixAt(i, ZERO); any = true; } continue; }
      any = true;
      D.age[i] += dt;
      const i3 = i * 3, s = D.size[i] * (D.age[i] > 2.8 ? Math.max(0, (3.4 - D.age[i]) / 0.6) : 1);
      D.vel[i3 + 1] -= 24 * dt;
      D.pos[i3] += D.vel[i3] * dt; D.pos[i3 + 1] += D.vel[i3 + 1] * dt; D.pos[i3 + 2] += D.vel[i3 + 2] * dt;
      const g = Math.max(groundAt(D.pos[i3], D.pos[i3 + 2]), SEA_Y) + s * 0.5;
      if (D.pos[i3 + 1] < g) {
        D.pos[i3 + 1] = g; D.vel[i3 + 1] *= -0.32; D.vel[i3] *= 0.55; D.vel[i3 + 2] *= 0.55;
        for (let j = 0; j < 3; j++) D.spin[i3 + j] *= 0.5;
      }
      for (let j = 0; j < 3; j++) D.rot[i3 + j] += D.spin[i3 + j] * dt;
      _p.set(D.pos[i3], D.pos[i3 + 1], D.pos[i3 + 2]);
      _q.setFromEuler(_e.set(D.rot[i3], D.rot[i3 + 1], D.rot[i3 + 2]));
      D.mesh.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(s)));
      D.inkMesh.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(s * 1.22)));
    }
    D.mesh.instanceMatrix.needsUpdate = D.inkMesh.instanceMatrix.needsUpdate = true;
    D.active = any;
  }

  // ---- wall decals ------------------------------------------------------------------------
  function decal(kind, ti, tier, x, y, z, n, size) {
    const P = built.decals[kind], i = P.next;
    P.next = (i + 1) % P.cap;
    P.own[i] = ti; P.tier[i] = tier; P.size[i] = size;
    P.pos[i * 3] = x + n.x * 0.06; P.pos[i * 3 + 1] = y + n.y * 0.06; P.pos[i * 3 + 2] = z + n.z * 0.06;
    _q.setFromUnitVectors(_Z, _n.set(n.x, n.y, n.z));
    _q0.setFromAxisAngle(_Z, Math.random() * Math.PI * 2); _q.multiply(_q0); _q0.identity();
    P.quat[i * 4] = _q.x; P.quat[i * 4 + 1] = _q.y; P.quat[i * 4 + 2] = _q.z; P.quat[i * 4 + 3] = _q.w;
    drawDecal(P, i, 0);
  }
  function drawDecal(P, i, sink) {
    _p.set(P.pos[i * 3], P.pos[i * 3 + 1] - sink, P.pos[i * 3 + 2]);
    _q.set(P.quat[i * 4], P.quat[i * 4 + 1], P.quat[i * 4 + 2], P.quat[i * 4 + 3]);
    P.mesh.setMatrixAt(i, _p.y < 0.05 ? ZERO : _m.compose(_p, _q, _s.setScalar(P.size[i])));
    P.mesh.instanceMatrix.needsUpdate = true;
  }
  // Re-seat a building's decals after it sank; drop those on tiers that fell (tier >= keep).
  function decalsFor(ti, sink, keep) {
    for (const P of Object.values(built.decals)) {
      for (let i = 0; i < P.cap; i++) {
        if (P.own[i] !== ti) continue;
        if (P.tier[i] >= keep) { P.own[i] = -1; P.mesh.setMatrixAt(i, ZERO); P.mesh.instanceMatrix.needsUpdate = true; }
        else drawDecal(P, i, sink);
      }
    }
  }

  // ---- targets ----------------------------------------------------------------------------
  const nameOf = (b) => b?.repo?.full_name || b?.repo?.name || '';
  function snapshot(b) {
    const g = b.mesh;
    return {
      x: g.position.x, y: g.position.y, z: g.position.z, rx: g.rotation.x, rz: g.rotation.z, visible: g.visible,
      colors: (b.bodyMats || []).map((m) => m.color.getHex()),
      kids: g.children.map((o) => ({ o, px: o.position.x, py: o.position.y, pz: o.position.z, rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z, v: o.visible })),
    };
  }
  // Split the building group into tiers (body + cap + hull + whatever sits in that band),
  // the roof (props above the top cap) and the repo sign, and box each tier in world space.
  function anatomy(tg) {
    const g = tg.b.mesh, bodies = tg.b.bodies || (tg.b.body ? [tg.b.body] : []);
    g.updateWorldMatrix(true, true);
    tg.tiers = bodies.map((body) => {
      const h = body.geometry?.parameters?.height ?? 1, base = body.position.y - h / 2;
      const box = new THREE.Box3().setFromObject(body);
      box.max.y += 0.7; // its roof cap
      return { body, h, base, top: base + h + 0.7, parts: [], box };
    });
    if (!tg.tiers.length) {
      const box = new THREE.Box3().setFromObject(g);
      tg.tiers = [{ body: null, h: box.max.y, base: 0, top: box.max.y, parts: [...g.children], box }];
    }
    const topY = tg.tiers[tg.tiers.length - 1].top;
    tg.roof = []; tg.sign = null;
    for (const o of g.children) {
      if (o.name === 'repo-sign') { tg.sign = o; continue; }
      const tier = tg.tiers.find((t) => t.body === o);
      if (tier) { tier.parts.push(o); continue; }
      const y = o.position.y;
      if (y >= topY - 0.05) { tg.roof.push(o); continue; }
      (tg.tiers.find((t) => y >= t.base - 0.01 && y <= t.top + 0.01) || tg.tiers[0]).parts.push(o);
    }
    tg.cur = tg.tiers.map((t) => t.box.clone());
    tg.boxes = [];
    tg.box = new THREE.Box3();
    const b0 = tg.tiers[0].box;
    tg.cx = (b0.min.x + b0.max.x) / 2; tg.cz = (b0.min.z + b0.max.z) / 2;
    tg.fw = Math.max(b0.max.x - b0.min.x, b0.max.z - b0.min.z);
    tg.top0 = tg.tiers.reduce((m, t) => Math.max(m, t.box.max.y), 0);
    tg.left = tg.tiers.length; tg.sink = 0; tg.sinkTo = 0; tg.rubble = null;
    tg.falling = new Set(); tg.plan = structureAt(tg.tiers.length, 0);
    refreshBoxes(tg);
  }
  // Collision follows the damaged shape: standing tiers only, lowered by how far it sank.
  function refreshBoxes(tg) {
    tg.boxes.length = 0;
    tg.box.makeEmpty();
    for (let i = 0; i < tg.left; i++) {
      const B = tg.cur[i].copy(tg.tiers[i].box);
      B.max.y = Math.max(B.min.y + 0.05, B.max.y - tg.sink);
      if (B.max.y > 0.3) { tg.boxes.push(B); tg.box.union(B); }
    }
    tg.top = tg.box.isEmpty() ? 0 : tg.box.max.y;
  }
  function makeTargets() {
    const list = deps.buildings?.() || [];
    targets = list.filter((b) => b?.mesh).map((b, i) => {
      const repo = b.repo || {};
      const tg = { i, b, name: nameOf(b), label: repo.name || nameOf(b) || 'building', stars: repo.stargazers_count || 0,
        lang: repo.language || '', snap: snapshot(b), state: 'ok', stage: 0, crumble: 0, flash: 0, emit: 0, shed: 0,
        lean: 0, leanTo: 0, leanDir: Math.random() * Math.PI * 2, dealt: 0, acc: 0, accAt: 0, accX: 0, accY: 0, accZ: 0, barUntil: 0 };
      anatomy(tg);
      tg.max = tg.hp = buildingHp(tg.top0, tg.fw);
      const roof = b.roofMat?.color?.getHex?.() ?? 0x8a8f9c;
      tg.color = roof;
      tg.colors = [roof, 0xe9e4d8, 0x3a4152, roof, 0xc9b99a];
      return tg;
    });
  }
  function restoreTarget(tg) {
    const g = tg.b.mesh, s = tg.snap;
    if (!g) return;
    g.position.set(s.x, s.y, s.z); g.rotation.x = s.rx; g.rotation.z = s.rz; g.visible = s.visible;
    for (const k of s.kids) { k.o.position.set(k.px, k.py, k.pz); k.o.rotation.set(k.rx, k.ry, k.rz); k.o.visible = k.v; }
    (tg.b.bodyMats || []).forEach((m, i) => { if (s.colors[i] != null) m.color.setHex(s.colors[i]); });
  }
  function setFlash(tg, on) {
    (tg.b.bodyMats || []).forEach((m, i) => { if (on) m.color.setScalar(2.4); else if (tg.snap.colors[i] != null) m.color.setHex(tg.snap.colors[i]); });
  }
  const kidSnap = (tg, o) => tg.snap.kids.find((k) => k.o === o);
  // Knock parts off: they tip and drop out of sight, with debris where they were.
  function dropParts(tg, parts, wx, wy, wz, big) {
    const live = parts.filter((o) => o.visible && !tg.falling.has(o));
    if (!live.length) return;
    for (const o of live) tg.falling.add(o);
    falls.push({ tg, parts: live.map((o) => ({ o, k: kidSnap(tg, o) })), t: 0, dur: big ? 1.1 : 0.8, h: big ? 16 : 7,
      spin: (Math.random() - 0.5) * (big ? 1.2 : 2.4), dx: (Math.random() - 0.5) * (big ? 2 : 3), dz: (Math.random() - 0.5) * (big ? 2 : 3) });
    throwDebris(big ? 16 : 7, wx, wy, wz, big ? tg.fw * 0.6 : 1.5, tg.colors, big ? 1 : 0.7);
    burst('dust', big ? 10 : 4, wx, wy, wz, big ? 5 : 3, big ? 1.4 : 0.9, 0.2);
  }
  function stepFalls(dt) {
    for (let j = falls.length - 1; j >= 0; j--) {
      const f = falls[j];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur), e = k * k;
      for (const { o, k: s } of f.parts) {
        if (!s) continue;
        o.position.set(s.px + f.dx * e, s.py - f.h * e, s.pz + f.dz * e); // parts ride the (sinking) group
        o.rotation.set(s.rx + f.spin * 0.5 * e, s.ry, s.rz + f.spin * e);
      }
      if (k >= 1) { for (const { o } of f.parts) { o.visible = false; f.tg.falling.delete(o); } falls.splice(j, 1); }
    }
  }
  // Move the building to the shape its HP calls for.
  function applyStage(tg, stage) {
    if (stage <= tg.stage || tg.state !== 'ok') return;
    const plan = structureAt(tg.tiers.length, Math.min(stage, 4)), g = tg.b.mesh;
    const wx = tg.cx, wz = tg.cz;
    if (!plan.roof && tg.roof.some((o) => o.visible)) { // roof props and the sign go first
      dropParts(tg, tg.roof, wx, tg.top + 0.5, wz, false);
      if (tg.sign?.visible) { tg.sign.visible = false; burst('chip', 5, wx, tg.top, wz, 3, 1, 0.3); }
    } else if (!plan.roof && tg.sign?.visible) { tg.sign.visible = false; burst('chip', 5, wx, tg.top, wz, 3, 1, 0.3); }
    while (tg.left > plan.tiers) { // tiers crumble off top-down
      const t = tg.tiers[tg.left - 1];
      tg.left--;
      dropParts(tg, t.parts.concat(tg.roof), wx, (t.box.min.y + t.box.max.y) / 2, wz, true);
      decalsFor(tg.i, tg.sink, tg.left);
      deps.shake?.(0.25);
      sfx('boom', 0.4);
    }
    tg.sinkTo = Math.max(tg.sinkTo, plan.cut * tg.tiers[0].h); // single blocks shed height in chunks
    if (plan.lean) tg.leanTo = 0.06 + Math.random() * 0.03;
    if (stage >= 2 && stage < 5 && stage > tg.stage) note(`${tg.label} · ${STAGE_LABELS[stage]}`);
    tg.stage = stage;
    tg.plan = plan;
    refreshBoxes(tg);
    g.updateWorldMatrix(false, false);
  }
  function damage(tg, dmg, x, y, z, kind = 'gun') {
    if (tg.state !== 'ok' || state !== 'play' || !(dmg > 0)) return;
    const real = Math.min(tg.hp, dmg);
    tg.hp = applyDamage(tg.hp, dmg);
    tg.dealt += real;
    tg.flash = 0.07; setFlash(tg, true);
    tg.barUntil = performance.now() + 3500;
    lastHit = tg; lastHitAt = performance.now();
    if (kind === 'gun') { tg.acc += real; tg.accX = x; tg.accY = y; tg.accZ = z; }
    else { popNumber(`−${Math.round(real)}`, x, y, z, true); if (real >= 1) note(`−${Math.round(real)} · ${tg.label}`); }
    applyStage(tg, damageStage(tg.hp, tg.max));
    if (tg.hp <= 0) { tg.state = 'crumbling'; tg.crumble = 0; tg.leanTo = Math.max(tg.leanTo, 0.1); tg.plan = structureAt(tg.tiers.length, 4); setFlash(tg, false); }
  }
  // Final collapse: the stump sinks and breaks apart, then rubble — only now it counts.
  function finish(tg) {
    tg.state = 'down';
    tg.b.mesh.visible = false;
    decalsFor(tg.i, 0, 0);
    addRubble(tg);
    for (let k = 0, c = amount(14); k < c; k++) {
      const a = (k / c) * Math.PI * 2, r = tg.fw * 0.55 + 0.6;
      emit('dust', tg.cx + Math.cos(a) * r, 0.8, tg.cz + Math.sin(a) * r, Math.cos(a) * 5, 0.6, Math.sin(a) * 5, 1.5);
    }
    kills++;
    combo = nextCombo(combo, playT - lastKill);
    lastKill = playT;
    score += killScore(tg.stars, combo);
    note(`💥 ${tg.label} destroyed · +${formatStars(tg.stars)}★${combo > 1 ? ` · combo ×${combo}` : ''}`, true);
    deps.shake?.(0.5);
    sfx('boom', 0.8);
  }
  function addRubble(tg) {
    const R = built.rubble, S = built.scorch;
    if (S.n < CAP.scorch) {
      _p.set(tg.cx, Math.max(0.02, groundAt(tg.cx, tg.cz)) + 0.03, tg.cz);
      S.mesh.setMatrixAt(S.n++, _m.compose(_p, _q0, _s.set(tg.fw * 1.6, 1, tg.fw * 1.6)));
      S.mesh.count = S.n; S.mesh.instanceMatrix.needsUpdate = true;
    }
    let top = 0;
    for (let k = 0; k < 6 && R.n < CAP.rubble; k++, R.n++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * tg.fw * 0.35, sz = tg.fw * (0.22 + Math.random() * 0.2);
      _p.set(tg.cx + Math.cos(a) * r, sz * 0.2, tg.cz + Math.sin(a) * r);
      top = Math.max(top, sz * 0.5);
      _q.setFromEuler(_e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      _s.set(sz, sz * 0.55, sz);
      R.mesh.setMatrixAt(R.n, _m.compose(_p, _q, _s));
      R.inkMesh.setMatrixAt(R.n, _m.compose(_p, _q, _s.multiplyScalar(1.14)));
      R.mesh.setColorAt(R.n, _c.set(tg.colors[k % tg.colors.length]));
    }
    R.mesh.count = R.inkMesh.count = R.n;
    R.mesh.instanceMatrix.needsUpdate = R.inkMesh.instanceMatrix.needsUpdate = true;
    if (R.mesh.instanceColor) R.mesh.instanceColor.needsUpdate = true;
    const h = tg.fw * 0.36; // the pile you can still fly into at ground level
    tg.rubble = new THREE.Box3(new THREE.Vector3(tg.cx - tg.fw * 0.45, 0, tg.cz - tg.fw * 0.45), new THREE.Vector3(tg.cx + tg.fw * 0.45, Math.max(top, h), tg.cz + tg.fw * 0.45));
  }
  // A random point on the building's current walls (for fire in the windows, falling bits).
  function wallPoint(tg, out) {
    const B = tg.boxes[Math.floor(Math.random() * tg.boxes.length)] || tg.box;
    if (!B || B.isEmpty()) return null;
    const side = Math.floor(Math.random() * 4), u = Math.random();
    const y = B.min.y + 0.8 + Math.random() * Math.max(0.2, B.max.y - B.min.y - 1.2);
    if (side === 0) out.set(B.min.x - 0.1, y, B.min.z + u * (B.max.z - B.min.z)), _n.set(-1, 0, 0);
    else if (side === 1) out.set(B.max.x + 0.1, y, B.min.z + u * (B.max.z - B.min.z)), _n.set(1, 0, 0);
    else if (side === 2) out.set(B.min.x + u * (B.max.x - B.min.x), y, B.min.z - 0.1), _n.set(0, 0, -1);
    else out.set(B.min.x + u * (B.max.x - B.min.x), y, B.max.z + 0.1), _n.set(0, 0, 1);
    return out;
  }
  function stepTargets(dt) {
    const now = performance.now();
    for (const tg of targets) {
      if (tg.flash > 0) { tg.flash -= dt; if (tg.flash <= 0) setFlash(tg, false); }
      if (tg.state === 'down') continue;
      const g = tg.b.mesh, s = tg.snap;
      // Aggregate gun damage into one floating number per building every 0.25 s.
      if (tg.acc > 0 && now >= tg.accAt) { popNumber(`−${Math.round(tg.acc)}`, tg.accX, tg.accY, tg.accZ, false); tg.acc = 0; tg.accAt = now + 250; }
      // Sink (chunks off a single block, the final crumble) and lean.
      let moved = false;
      if (tg.state === 'crumbling') {
        tg.crumble += dt;
        const k = Math.min(1, tg.crumble / GAME.CRUMBLE);
        tg.sinkTo = Math.max(tg.sinkTo, k * k * (tg.top0 + 1));
        if ((tg.emit -= dt) <= 0) {
          tg.emit = 0.08;
          const a = Math.random() * Math.PI * 2, r = tg.fw * 0.55 + 0.4;
          emit('dust', tg.cx + Math.cos(a) * r, 0.5 + Math.random() * 1.5, tg.cz + Math.sin(a) * r, Math.cos(a) * 3, 0.9, Math.sin(a) * 3, 1.2);
          if (Math.random() < 0.5) throwDebris(1, tg.cx, Math.max(1, tg.top - 1), tg.cz, tg.fw * 0.7, tg.colors, 0.6);
        }
        if (k >= 1) { finish(tg); continue; }
      }
      if (tg.sink < tg.sinkTo) {
        tg.sink = Math.min(tg.sinkTo, tg.sink + dt * (tg.state === 'crumbling' ? 30 : 6));
        moved = true;
        if (Math.random() < 0.35) emit('dust', tg.cx + (Math.random() - 0.5) * tg.fw, 0.6, tg.cz + (Math.random() - 0.5) * tg.fw, 0, 0.8, 0, 1.1);
      }
      if (tg.lean < tg.leanTo) { tg.lean = Math.min(tg.leanTo, tg.lean + dt * 0.05); moved = true; }
      if (moved || tg.state === 'crumbling') {
        const j = tg.state === 'crumbling' ? 0.2 * (1 - tg.crumble / GAME.CRUMBLE) : 0;
        g.position.set(s.x + (Math.random() - 0.5) * j, s.y - tg.sink, s.z + (Math.random() - 0.5) * j);
        g.rotation.x = s.rx + Math.cos(tg.leanDir) * tg.lean; g.rotation.z = s.rz + Math.sin(tg.leanDir) * tg.lean;
        refreshBoxes(tg);
        decalsFor(tg.i, tg.sink, tg.left);
      }
      // Smoke from stage 2, fire in the windows and falling bits at low HP.
      const plan = tg.plan; // cached per stage: no per-frame allocation
      if (plan.smoke && (tg.emit -= dt) <= 0) {
        tg.emit = plan.fire ? 0.1 : 0.26;
        emit('smoke', tg.cx + (Math.random() - 0.5) * tg.fw * 0.5, tg.top + 0.3, tg.cz + (Math.random() - 0.5) * tg.fw * 0.5, (Math.random() - 0.5), 0.9, (Math.random() - 0.5), plan.fire ? 1.5 : 1);
        if (plan.fire && wallPoint(tg, _v)) {
          emit('fire', _v.x, _v.y, _v.z, _n.x * 1.5, 1.2, _n.z * 1.5, 0.9);
          emit('smoke', _v.x + _n.x, _v.y + 0.6, _v.z + _n.z, _n.x, 1.4, _n.z, 1.3);
        }
      }
      if (plan.fire && tg.state === 'ok' && (tg.shed -= dt) <= 0) {
        tg.shed = 0.9 + Math.random() * 0.8;
        if (wallPoint(tg, _v)) throwDebris(1, _v.x, _v.y, _v.z, 0.4, tg.colors, 0.35);
      }
    }
  }

  // ---- weapons ------------------------------------------------------------------------------
  function fire(P) {
    const B = built.bullets;
    let i = -1;
    for (let k = 0; k < B.cap; k++) if (B.age[k] >= GAME.BULLET_LIFE) { i = k; break; }
    if (i < 0) return;
    const i3 = i * 3, side = (gunSide = -gunSide);
    // Wing guns, alternating; a little scatter.
    B.pos[i3] = P.x + P.fx * 2.4 + P.rx * side * 1.1; B.pos[i3 + 1] = P.y + P.fy * 2.4 - 0.1; B.pos[i3 + 2] = P.z + P.fz * 2.4 + P.rz * side * 1.1;
    _d.set(P.fx + (Math.random() - 0.5) * 2 * GAME.SPREAD, P.fy + (Math.random() - 0.5) * 2 * GAME.SPREAD, P.fz + (Math.random() - 0.5) * 2 * GAME.SPREAD).normalize();
    B.vel[i3] = _d.x * GAME.BULLET_SPEED + P.vx; B.vel[i3 + 1] = _d.y * GAME.BULLET_SPEED + P.vy; B.vel[i3 + 2] = _d.z * GAME.BULLET_SPEED + P.vz;
    B.age[i] = 0; B.active = true;
    shots++;
    emit('muzzle', B.pos[i3], B.pos[i3 + 1], B.pos[i3 + 2], P.vx, P.vy, P.vz);
    sfx('pew');
  }
  // First standing building box along a ray within `maxD`: { tg, tier, d } or null.
  function rayHit(origin, dir, maxD) {
    _ray.set(origin, dir);
    let best = maxD, hitT = null, tier = 0;
    for (const tg of targets) {
      if (tg.state === 'down' || !tg.boxes.length) continue;
      if (!_ray.intersectBox(tg.box, _hit) || _hit.distanceTo(origin) > best) continue;
      for (let k = 0; k < tg.boxes.length; k++) {
        if (_ray.intersectBox(tg.boxes[k], _hit)) { const dd = _hit.distanceTo(origin); if (dd < best) { best = dd; hitT = tg; tier = k; } }
      }
    }
    if (!hitT) return null;
    _rh.tg = hitT; _rh.tier = tier; _rh.d = best;
    return _rh; // shared result
  }
  const _rh = { tg: null, tier: 0, d: 0 };
  function stepBullets(dt) {
    const B = built.bullets;
    if (!B.active) return;
    let any = false;
    for (let i = 0; i < B.cap; i++) {
      if (B.age[i] >= GAME.BULLET_LIFE) { if (B.age[i] < 1e8) { B.age[i] = 1e9; B.mesh.setMatrixAt(i, ZERO); any = true; } continue; }
      any = true;
      const i3 = i * 3;
      _p.set(B.pos[i3], B.pos[i3 + 1], B.pos[i3 + 2]);
      _v.set(B.vel[i3], B.vel[i3 + 1], B.vel[i3 + 2]);
      const speed = _v.length(), len = speed * dt;
      _d.copy(_v).divideScalar(speed || 1);
      const h = state === 'play' ? rayHit(_p, _d, len) : null;
      if (h) {
        _ray.at(h.d, _hit);
        hits++;
        const n = faceNormal(_hit, h.tg.boxes[h.tier]);
        burst('spark', 4, _hit.x, _hit.y, _hit.z, 9, 1, 0.2);
        emit('chip', _hit.x + n.x * 0.3, _hit.y, _hit.z + n.z * 0.3, n.x * 2, 0.6, n.z * 2, 0.8);
        if (Math.random() < 0.34) decal('crack', h.tg.i, h.tier, _hit.x, _hit.y, _hit.z, n, 0.9 + Math.random() * 0.6);
        if (n.y === 0 && Math.random() < 0.3) decal('window', h.tg.i, h.tier, _hit.x + (Math.random() - 0.5) * 0.8, _hit.y + (Math.random() - 0.5) * 0.8, _hit.z + (Math.random() - 0.5) * 0.8, n, 0.75 + Math.random() * 0.3);
        damage(h.tg, GAME.BULLET_DAMAGE, _hit.x, _hit.y, _hit.z, 'gun');
        B.age[i] = GAME.BULLET_LIFE; continue;
      }
      _p.addScaledVector(_v, dt);
      B.pos[i3] = _p.x; B.pos[i3 + 1] = _p.y; B.pos[i3 + 2] = _p.z;
      B.age[i] += dt;
      if (_p.y < Math.max(groundAt(_p.x, _p.z), SEA_Y)) { burst(_p.y < SEA_Y + 0.2 ? 'splash' : 'spark', 3, _p.x, _p.y + 0.2, _p.z, 5, 0.6, 0.6); B.age[i] = GAME.BULLET_LIFE; continue; }
      _q.setFromUnitVectors(_X, _d);
      B.mesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(2.2, 0.16, 0.16)));
    }
    B.mesh.instanceMatrix.needsUpdate = true;
    B.active = any;
  }
  function dropBomb(P) {
    const slot = built.bombs.find((bm) => !bm.live);
    if (!slot || bombs < 1) return;
    bombs--;
    slot.live = true; slot.age = 0;
    slot.pos.set(P.x - P.fx * 0.4, P.y - 1.3, P.z - P.fz * 0.4);
    slot.vel.set(P.vx * 0.95, P.vy * 0.95 - 3, P.vz * 0.95);
    slot.g.visible = true;
    sfx('drop');
  }
  function stepBombs(dt) {
    for (const bm of built.bombs) {
      if (!bm.live) continue;
      bm.age += dt;
      bm.vel.y -= GAME.GRAVITY * dt;
      bm.pos.addScaledVector(bm.vel, dt);
      _d.copy(bm.vel).normalize();
      bm.g.position.copy(bm.pos);
      bm.g.quaternion.setFromUnitVectors(_X, _d);
      let hitT = null, box = null;
      for (const tg of targets) {
        if (tg.state === 'down' || !tg.boxes.length || boxDistance(bm.pos, tg.box) > 0.3) continue;
        for (const bx of tg.boxes) if (boxDistance(bm.pos, bx) <= 0.3) { hitT = tg; box = bx; break; }
        if (hitT) break;
      }
      const g = groundAt(bm.pos.x, bm.pos.z), sea = g < SEA_Y && bm.pos.y <= SEA_Y + 0.2;
      if (hitT || bm.pos.y <= Math.max(g, SEA_Y) + 0.25 || bm.age > 9) {
        bm.live = false; bm.g.visible = false;
        if (hitT) { // a chunk knocked off where it struck: a big scorch on that face and debris raining down
          const n = faceNormal(bm.pos, box);
          decal('crack', hitT.i, hitT.boxes.indexOf(box), bm.pos.x, bm.pos.y, bm.pos.z, n, 3.2);
          throwDebris(10, bm.pos.x, bm.pos.y, bm.pos.z, 1.5, hitT.colors, 1.1);
        }
        explode(bm.pos.x, Math.max(bm.pos.y, g, SEA_Y), bm.pos.z, { sea });
      }
    }
  }
  const blastLog = []; // debug: the last few explosions and what they hurt
  function explode(x, y, z, { big = false, sea = false, harm = true } = {}) {
    const rec = { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), state, harm, hurt: [] };
    blastLog.push(rec); if (blastLog.length > 6) blastLog.shift();
    if (sea) { burst('splash', 16, x, y + 0.4, z, 9, big ? 1.8 : 1.2, 1.2); burst('blast', 5, x, y + 0.6, z, 4, 0.8, 0.4); }
    else {
      burst('blast', big ? 26 : 14, x, y + 0.6, z, big ? 12 : 8, big ? 1.6 : 1.1, 0.4);
      burst('fire', big ? 10 : 6, x, y + 0.8, z, 4, 1, 0.8);
      burst('spark', big ? 18 : 10, x, y + 0.8, z, 16, 1, 0.5);
    }
    burst('smoke', big ? 14 : 8, x, y + 1.2, z, 3.5, big ? 1.6 : 1.2, 0.8);
    if (harm && state === 'play') {
      _blast.set(x, y, z);
      for (const tg of targets) {
        if (tg.state !== 'ok' || !tg.boxes.length) continue;
        const d = boxDistance(_blast, tg.box), dmg = bombDamage(d);
        rec.hurt.push([tg.label, +d.toFixed(2), dmg]);
        if (dmg > 0) damage(tg, dmg, clamp(x, tg.box.min.x, tg.box.max.x), clamp(y, tg.box.min.y, tg.box.max.y), clamp(z, tg.box.min.z, tg.box.max.z), 'bomb');
      }
    }
    const P = deps.plane?.state?.();
    const near = P ? clamp(1 - Math.hypot(P.x - x, P.y - y, P.z - z) / 90, 0.2, 1) : 0.6;
    deps.shake?.((big ? 1.3 : 0.7) * near);
    sfx('boom', big ? 1 : 0.75);
  }

  // ---- crash ----------------------------------------------------------------------------------
  // What the plane flew into (a building's current shape, its rubble, the monument,
  // the ground or the sea), or null. `repo` names the building for the card.
  function crashTest(P) {
    if (P.y - 1.0 < SEA_Y && groundAt(P.x, P.z) < SEA_Y) return { what: 'the sea' };
    if (P.y - 1.15 < groundAt(P.x, P.z)) return { what: 'the ground' };
    for (const o of deps.obstacles || []) {
      if (P.y < o.h + GAME.PLANE_RADIUS && Math.hypot(P.x - o.x, P.z - o.z) < o.r + GAME.PLANE_RADIUS) return { what: o.what || 'the monument' };
    }
    _p.set(P.x, P.y, P.z);
    for (const tg of targets) {
      if (tg.state === 'down') {
        if (tg.rubble && boxDistance(_p, tg.rubble) <= GAME.PLANE_RADIUS) return { what: `the rubble of ${tg.label}`, repo: tg.label };
        continue;
      }
      if (!tg.boxes.length || boxDistance(_p, tg.box) > GAME.PLANE_RADIUS) continue;
      for (const bx of tg.boxes) if (boxDistance(_p, bx) <= GAME.PLANE_RADIUS) return { what: tg.label, repo: tg.label };
    }
    return null;
  }
  function crash(P, hit) {
    state = 'over'; endKind = 'crash'; crashWhat = hit.what; crashRepo = hit.repo || ''; endT = 1.5;
    explode(P.x, P.y, P.z, { big: true, harm: false, sea: hit.what === 'the sea' });
    throwDebris(12, P.x, P.y, P.z, 1.5, [0xef5b4c, 0xf6efe1, 0x2a2f3a, 0x9a6a4a]);
    deps.plane?.crash?.();
    deps.shake?.(1.4);
    syncHud(true);
  }

  // ---- audio (tiny WebAudio synth, off by default) -------------------------------------------------
  let muted = true, actx = null, noise = null, lastPew = 0;
  try { muted = localStorage.getItem('gc-bombrun-sound') !== 'on'; } catch { /* storage unavailable */ }
  function audio() {
    if (actx) return actx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return actx;
  }
  function sfx(kind, vol = 1) {
    if (muted) return;
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime, g = ac.createGain();
    g.connect(ac.destination);
    if (kind === 'pew') {
      if (t - lastPew < 0.05) return;
      lastPew = t;
      const o = ac.createOscillator();
      o.type = 'square'; o.frequency.setValueAtTime(920, t); o.frequency.exponentialRampToValueAtTime(240, t + 0.07);
      g.gain.setValueAtTime(0.035, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g); o.start(t); o.stop(t + 0.09);
    } else if (kind === 'drop') {
      const o = ac.createOscillator();
      o.type = 'triangle'; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.5);
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); o.start(t); o.stop(t + 0.52);
    } else {
      const src = ac.createBufferSource(), f = ac.createBiquadFilter();
      src.buffer = noise; f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(90, t + 0.7);
      g.gain.setValueAtTime(0.4 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      src.connect(f); f.connect(g); src.start(t); src.stop(t + 0.82);
    }
  }

  // ---- DOM -------------------------------------------------------------------------------------------
  injectGameStyle();
  const el = (cls, html, tag = 'div') => { const n = document.createElement(tag); n.className = cls; n.innerHTML = html; return n; };
  const hud = el('gbr-hud', `
    <span class="gbr-stat gbr-score" title="Score"><b>0</b><small>pts</small></span>
    <span class="gbr-stat gbr-kills" title="Repos destroyed"><b>0</b>/<span>0</span><small>repos</small></span>
    <span class="gbr-stat gbr-bombs" title="Bombs (B / right-click)"><i></i><i></i><i></i></span>
    <span class="gbr-stat gbr-combo" hidden>×<b>2</b></span>
    <span class="gbr-stat gbr-time" title="Time">0:00</span>
    <button type="button" class="gbr-mute" title="Sound effects"></button>
    <button type="button" class="gbr-exit" title="Leave the game (Esc)"><kbd>Esc</kbd> End game</button>`);
  hud.hidden = true;
  hud.setAttribute('role', 'status');
  const warnEl = el('gbr-warn', '↩ Back to the city');
  warnEl.hidden = true;
  const arrowEl = el('gbr-arrow', '<i></i><span></span>');
  arrowEl.hidden = true;
  const arrowI = arrowEl.querySelector('i'), arrowS = arrowEl.querySelector('span');
  const crossEl = el('gbr-cross', '<i></i>');
  crossEl.hidden = true;
  const panel = el('gbr-target', `<div class="gbr-t-kicker">Target</div><div class="gbr-t-name"></div>
    <div class="gbr-t-meta"><span class="gbr-t-stars"></span><span class="gbr-t-lang"></span></div>
    <div class="gbr-t-bar"><i></i></div><div class="gbr-t-row"><span class="gbr-t-hp"></span><span class="gbr-t-stage"></span></div>
    <div class="gbr-t-prog"></div>`);
  panel.hidden = true;
  const pName = panel.querySelector('.gbr-t-name'), pStars = panel.querySelector('.gbr-t-stars'), pLang = panel.querySelector('.gbr-t-lang');
  const pBar = panel.querySelector('.gbr-t-bar i'), pHp = panel.querySelector('.gbr-t-hp'), pStage = panel.querySelector('.gbr-t-stage'), pProg = panel.querySelector('.gbr-t-prog');
  const bars = Array.from({ length: 6 }, () => {
    const n = el('gbr-bar', '<b></b><span></span><i><em></em></i>');
    n.hidden = true;
    return { n, name: n.querySelector('b'), stage: n.querySelector('span'), fill: n.querySelector('em'), tg: null, key: '' };
  });
  const nums = Array.from({ length: 24 }, () => { const n = el('gbr-num', ''); n.hidden = true; return n; });
  let numNext = 0;
  const countEl = el('gbr-count', '');
  countEl.hidden = true;
  const feedEl = el('gbr-feed', '');
  feedEl.setAttribute('aria-live', 'polite');
  const endEl = el('gbr-end', `<div class="gbr-card" role="dialog" aria-modal="true" aria-labelledby="gbr-title">
      <div class="gbr-kicker">Bomb run</div><h2 id="gbr-title"></h2><p class="gbr-why"></p>
      <dl class="gbr-grid"></dl>
      <div class="gbr-list-head">Repos hit · click one to tour it</div><ol class="gbr-list"></ol>
      <div class="gbr-actions"><button type="button" class="gbr-again">Play again</button><button type="button" class="gbr-leave">Exit</button></div>
    </div>`);
  endEl.hidden = true;
  const layer = el('gbr-layer', '');
  layer.append(...bars.map((b) => b.n), ...nums);
  document.body.append(layer, hud, countEl, feedEl, endEl, warnEl, arrowEl, crossEl, panel);
  const $h = (s) => hud.querySelector(s);
  const scoreB = $h('.gbr-score b'), killsB = $h('.gbr-kills b'), totalS = $h('.gbr-kills span'), comboEl = $h('.gbr-combo'), comboB = $h('.gbr-combo b');
  const timeEl = $h('.gbr-time'), pips = [...hud.querySelectorAll('.gbr-bombs i')], muteBtn = $h('.gbr-mute');
  const syncMute = () => { muteBtn.textContent = muted ? '🔇' : '🔊'; muteBtn.setAttribute('aria-pressed', String(!muted)); muteBtn.title = muted ? 'Sound off (click for pew-pew)' : 'Sound on'; };
  syncMute();
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation(); muted = !muted;
    try { localStorage.setItem('gc-bombrun-sound', muted ? 'off' : 'on'); } catch { /* ignore */ }
    if (!muted) audio()?.resume?.();
    syncMute(); muteBtn.blur();
  });
  $h('.gbr-exit').addEventListener('click', (e) => { e.stopPropagation(); exit(); });
  endEl.querySelector('.gbr-again').addEventListener('click', (e) => { e.stopPropagation(); playAgain(); });
  endEl.querySelector('.gbr-leave').addEventListener('click', (e) => { e.stopPropagation(); exit(); });
  // A repo on the end card: leave the game (city restored) and tour straight to it.
  endEl.querySelector('.gbr-list').addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-name]');
    if (!b) return;
    e.stopPropagation();
    deps.onRepo?.(b.dataset.name);
  });
  for (const n of [hud, endEl]) n.addEventListener('pointerdown', (e) => e.stopPropagation());
  const onEndKeys = (e) => {
    if (endEl.hidden) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); playAgain(); }
  };
  addEventListener('keydown', onEndKeys, true);

  function note(text, kill = false) {
    const n = el(kill ? 'gbr-toast kill' : 'gbr-toast', '');
    n.textContent = text;
    feedEl.prepend(n);
    while (feedEl.children.length > 5) feedEl.lastChild.remove();
    setTimeout(() => n.classList.add('out'), kill ? 2600 : 1600);
    setTimeout(() => n.remove(), kill ? 3100 : 2100);
  }
  const _sc = { x: 0, y: 0 };
  const toScreen = (x, y, z) => { // shared result: use it before the next call
    _p.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    if (_p.z > -0.5) return null;
    _p.applyMatrix4(camera.projectionMatrix);
    _sc.x = (_p.x + 1) / 2 * innerWidth; _sc.y = (1 - _p.y) / 2 * innerHeight;
    return _sc;
  };
  function popNumber(text, x, y, z, big) {
    if (!camera) return;
    camera.updateMatrixWorld();
    const s = toScreen(x, y, z);
    if (!s) return;
    const n = nums[numNext]; numNext = (numNext + 1) % nums.length;
    n.textContent = text;
    n.className = big ? 'gbr-num big' : 'gbr-num';
    n.style.left = `${s.x.toFixed(0)}px`; n.style.top = `${s.y.toFixed(0)}px`;
    n.hidden = false;
    void n.offsetWidth; n.classList.add('go');
    clearTimeout(n._t); n._t = setTimeout(() => { n.hidden = true; }, 950);
  }
  // Health bars over the buildings hit in the last few seconds (six at most).
  const barPick = [], byRecent = (a, b) => b.barUntil - a.barUntil;
  function stepBars() {
    const now = performance.now(), want = barPick;
    want.length = 0;
    for (const t of targets) if (t.barUntil > now && t.state !== 'down') want.push(t);
    if (want.length > bars.length) { want.sort(byRecent); want.length = bars.length; }
    for (const b of bars) if (b.tg && !want.includes(b.tg)) { b.tg = null; b.n.hidden = true; }
    for (const tg of want) {
      let b = bars.find((x) => x.tg === tg) || bars.find((x) => !x.tg);
      if (!b) continue;
      b.tg = tg;
      const s = toScreen(tg.cx, tg.top + 2.2, tg.cz);
      if (!s) { b.n.hidden = true; continue; }
      const frac = tg.hp / tg.max, key = `${tg.hp}|${tg.stage}|${tg.state}`;
      if (key !== b.key) {
        b.key = key;
        b.name.textContent = tg.label;
        b.stage.textContent = tg.state === 'crumbling' ? 'collapsing' : STAGE_LABELS[tg.stage];
        b.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
        b.n.dataset.tone = hpTone(frac);
      }
      b.n.style.opacity = String(clamp((tg.barUntil - now) / 800, 0, 1));
      b.n.style.transform = `translate(${s.x.toFixed(0)}px, ${s.y.toFixed(0)}px) translate(-50%, -100%)`;
      b.n.hidden = false;
    }
  }
  // Crosshair where the guns converge; red when a building is in the line of fire.
  function stepAim(P) {
    const live = P && state === 'play';
    crossEl.hidden = !live;
    if (!live) { aimed = null; return; }
    const s = toScreen(P.x + P.fx * 55, P.y + P.fy * 55, P.z + P.fz * 55);
    if (!s) { crossEl.hidden = true; return; }
    _v.set(P.x + P.fx * 2.4, P.y + P.fy * 2.4, P.z + P.fz * 2.4);
    _d.set(P.fx, P.fy, P.fz);
    aimed = rayHit(_v, _d, 170)?.tg || null;
    crossEl.style.transform = `translate(${s.x.toFixed(0)}px, ${s.y.toFixed(0)}px) translate(-50%, -50%)`;
    crossEl.classList.toggle('lock', !!aimed);
  }
  function stepPanel() {
    const tg = aimed || (performance.now() - lastHitAt < 5000 ? lastHit : null);
    panel.hidden = !tg || state === 'idle';
    if (!tg) return;
    const frac = tg.hp / tg.max;
    pName.textContent = tg.label;
    panel.style.setProperty('--lang', `#${tg.color.toString(16).padStart(6, '0')}`);
    pStars.textContent = `★ ${formatStars(tg.stars)}`;
    pLang.textContent = tg.lang || '';
    pBar.style.transform = `scaleX(${frac.toFixed(3)})`;
    panel.dataset.tone = hpTone(frac);
    pHp.textContent = tg.state === 'down' ? 'destroyed' : `${Math.ceil(frac * 100)}% HP`;
    pStage.textContent = tg.state === 'down' ? '✓' : tg.state === 'crumbling' ? 'collapsing…' : STAGE_LABELS[tg.stage];
    pProg.textContent = `${kills} / ${targets.length} destroyed`;
  }
  function syncHud(force = false) {
    const now = performance.now();
    if (!force && now < hudAt) return;
    hudAt = now + 100;
    scoreB.textContent = score.toLocaleString('en-US');
    killsB.textContent = String(kills);
    totalS.textContent = String(targets.length);
    const regenK = bombs >= GAME.BOMB_MAX ? 0 : regenT / GAME.BOMB_REGEN;
    pips.forEach((p, i) => {
      p.className = i < bombs ? 'on' : i === bombs ? 'regen' : '';
      p.style.setProperty('--k', i === bombs ? regenK.toFixed(2) : '0');
    });
    const comboLive = combo > 1 && playT - lastKill <= GAME.COMBO_WINDOW;
    comboEl.hidden = !comboLive;
    if (comboLive) { comboB.textContent = String(combo); comboEl.style.setProperty('--k', (1 - (playT - lastKill) / GAME.COMBO_WINDOW).toFixed(2)); }
    timeEl.textContent = formatTime(playT);
    stepPanel();
  }
  function showCount(text) {
    if (text === lastCount) return;
    lastCount = text;
    countEl.hidden = !text;
    if (!text) return;
    countEl.textContent = text;
    countEl.classList.remove('pop'); void countEl.offsetWidth; countEl.classList.add('pop');
  }
  function showEnd() {
    const win = endKind === 'win', login = deps.login?.() || '';
    let best = 0, isBest = false;
    try {
      best = Number(localStorage.getItem(bestKey(login))) || 0;
      if (score > best) { isBest = score > 0; best = score; localStorage.setItem(bestKey(login), String(score)); }
    } catch { best = Math.max(best, score); }
    endEl.querySelector('h2').textContent = win ? 'City flattened! 🏆' : 'Game over';
    const why = endEl.querySelector('.gbr-why');
    if (win) why.textContent = `Every repo on @${login}’s island is rubble.`;
    else {
      const b = document.createElement('b');
      b.textContent = crashWhat;
      why.replaceChildren('You flew into ', b, ' 💥');
    }
    const rows = [['Score', `${score.toLocaleString('en-US')}${isBest ? ' ✦ new best' : ''}`], ['Repos destroyed', `${kills} / ${targets.length}`],
      ['Time', formatTime(playT)], ['Accuracy', `${accuracy(hits, shots)}%`], [`Best on @${login}`, best.toLocaleString('en-US')]];
    const grid = endEl.querySelector('.gbr-grid');
    grid.replaceChildren(...rows.flatMap(([k, v]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; return [dt, dd]; }));
    // Every repo you damaged, most damage first.
    const hitList = targets.filter((t) => t.dealt > 0).sort((a, b) => b.dealt - a.dealt);
    const list = endEl.querySelector('.gbr-list');
    list.replaceChildren(...hitList.map((t) => {
      const li = document.createElement('li');
      const name = document.createElement('button'), stars = document.createElement('span'), status = document.createElement('span'), dmg = document.createElement('span');
      name.type = 'button'; name.dataset.name = t.name; name.title = `Tour to ${t.label}`;
      name.className = 'n'; stars.className = 's'; status.className = t.state === 'down' ? 'st done' : 'st'; dmg.className = 'd';
      name.textContent = t.label; name.style.setProperty('--lang', `#${t.color.toString(16).padStart(6, '0')}`);
      stars.textContent = `★ ${formatStars(t.stars)}`;
      status.textContent = t.state === 'down' ? '✓ destroyed' : `${Math.ceil((t.hp / t.max) * 100)}% HP`;
      dmg.textContent = `−${Math.round(t.dealt).toLocaleString('en-US')}`;
      li.append(name, stars, status, dmg);
      return li;
    }));
    endEl.querySelector('.gbr-list-head').hidden = !hitList.length;
    list.hidden = !hitList.length;
    endEl.classList.toggle('win', win);
    endEl.hidden = false;
    endEl.querySelector('.gbr-again').focus({ preventScroll: true });
  }

  // ---- lifecycle -------------------------------------------------------------------------------------
  function clearFx() {
    if (!built) return;
    for (const P of Object.values(built.pools)) { P.age.fill(1e9); P.life.fill(0); for (let i = 0; i < P.cap; i++) { P.mesh.setMatrixAt(i, ZERO); P.inkMesh.setMatrixAt(i, ZERO); } P.mesh.instanceMatrix.needsUpdate = P.inkMesh.instanceMatrix.needsUpdate = true; P.active = false; }
    const D = built.debris; D.age.fill(1e9); for (let i = 0; i < D.cap; i++) { D.mesh.setMatrixAt(i, ZERO); D.inkMesh.setMatrixAt(i, ZERO); } D.mesh.instanceMatrix.needsUpdate = D.inkMesh.instanceMatrix.needsUpdate = true; D.active = false;
    const B = built.bullets; B.age.fill(1e9); for (let i = 0; i < B.cap; i++) B.mesh.setMatrixAt(i, ZERO); B.mesh.instanceMatrix.needsUpdate = true; B.active = false;
    for (const P of Object.values(built.decals)) { P.own.fill(-1); for (let i = 0; i < P.cap; i++) P.mesh.setMatrixAt(i, ZERO); P.mesh.instanceMatrix.needsUpdate = true; }
    for (const bm of built.bombs) { bm.live = false; bm.g.visible = false; }
    built.rubble.n = built.scorch.n = 0;
    built.rubble.mesh.count = built.rubble.inkMesh.count = built.scorch.mesh.count = 0;
    falls = [];
  }
  function restoreCity() {
    for (const tg of targets) restoreTarget(tg);
    clearFx();
  }
  function hideOverlays() {
    for (const b of bars) { b.tg = null; b.n.hidden = true; }
    for (const n of nums) n.hidden = true;
    crossEl.hidden = panel.hidden = warnEl.hidden = arrowEl.hidden = true;
  }
  function resetRun() {
    score = kills = shots = hits = 0; combo = 1; lastKill = -99; playT = 0; countT = 0;
    bombs = GAME.BOMB_MAX; regenT = 0; fireT = 0; prevBomb = true; endKind = null; crashWhat = ''; crashRepo = '';
    lastHit = null; lastHitAt = -1e9; aimed = null;
    feedEl.replaceChildren();
    hideOverlays();
    makeTargets();
  }
  function begin() {
    resetRun();
    deps.plane?.respawn?.({ top: targets.reduce((m, t) => Math.max(m, t.top0), 0) });
    state = 'countdown'; lastCount = '';
    endEl.hidden = true; hud.hidden = false;
    document.body.classList.add('gbr-on');
    syncHud(true);
    deps.onChange?.();
  }
  function start() {
    if (state !== 'idle') return;
    build();
    if (!root.parent) scene.add(root);
    root.visible = true;
    deps.onStart?.();
    begin();
  }
  function playAgain() {
    if (state === 'idle') return;
    restoreCity();
    begin();
  }
  function exit() {
    if (state === 'idle') return;
    restoreCity();
    state = 'idle';
    hud.hidden = true; endEl.hidden = true; countEl.hidden = true; lastCount = '';
    hideOverlays();
    feedEl.replaceChildren();
    document.body.classList.remove('gbr-on');
    root.visible = false;
    targets = [];
    deps.plane?.release?.();
    deps.onChange?.();
  }
  // The host rebuilt buildings (a late building config): follow the replacements.
  function resync() {
    if (state === 'idle') return;
    const list = deps.buildings?.() || [];
    const byName = new Map(list.map((b) => [nameOf(b), b]));
    let found = 0;
    for (const tg of targets) {
      if (list.includes(tg.b)) { found++; continue; }
      const nb = byName.get(tg.name);
      if (!nb) continue;
      found++;
      tg.b = nb; tg.snap = snapshot(nb); anatomy(tg);
      if (tg.state !== 'ok') { nb.mesh.visible = false; tg.state = 'down'; }
      else { tg.stage = 0; applyStage(tg, damageStage(tg.hp, tg.max)); }
    }
    if (!found && targets.length) exit(); // a different city altogether
  }

  // "Back to the city" near the play-area edge; an arrow to the nearest standing
  // building when none is on screen.
  let guideAt = 0;
  function guide(P) {
    const live = P && (state === 'play' || state === 'countdown');
    warnEl.hidden = !(live && (deps.outside?.(P.x, P.z) ?? -1) > -15);
    const now = performance.now();
    if (now < guideAt) return;
    guideAt = now + 180;
    if (!live) { arrowEl.hidden = true; return; }
    let near = null, nd = Infinity, seen = false;
    for (const tg of targets) {
      if (tg.state === 'down') continue;
      _p.set(tg.cx, Math.max(1, tg.top * 0.6), tg.cz).project(camera);
      if (_p.z < 1 && Math.abs(_p.x) < 0.95 && Math.abs(_p.y) < 0.95) { seen = true; break; }
      const d = Math.hypot(tg.cx - P.x, tg.cz - P.z);
      if (d < nd) { nd = d; near = tg; }
    }
    arrowEl.hidden = seen || !near;
    if (seen || !near) return;
    _p.set(near.cx, Math.max(1, near.top * 0.6), near.cz).applyMatrix4(camera.matrixWorldInverse);
    const behind = _p.z > 0;
    _p.applyMatrix4(camera.projectionMatrix);
    let dx = _p.x, dy = -_p.y;
    if (behind) { dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx), W2 = innerWidth / 2, H2 = innerHeight / 2;
    const k = Math.min((W2 - 90) / Math.max(Math.abs(Math.cos(ang)) * W2, 1e-3), (H2 - 90) / Math.max(Math.abs(Math.sin(ang)) * H2, 1e-3));
    arrowEl.style.transform = `translate(${(W2 + Math.cos(ang) * W2 * k).toFixed(0)}px, ${(H2 + Math.sin(ang) * H2 * k).toFixed(0)}px) translate(-50%, -50%)`;
    arrowI.style.transform = `rotate(${ang.toFixed(3)}rad)`;
    arrowS.textContent = `${near.label} · ${Math.round(nd * 1.6)} m`;
  }

  function update(dt) {
    if (state === 'idle') return;
    const P = deps.plane?.state?.();
    if (state === 'countdown') {
      countT += dt;
      const left = GAME.COUNTDOWN - countT;
      showCount(left > 1.6 ? '3' : left > 0.8 ? '2' : left > 0 ? '1' : 'GO!');
      if (countT >= GAME.COUNTDOWN) { state = 'play'; prevBomb = true; deps.onChange?.(); }
    } else if (countT < GAME.COUNTDOWN + 0.6) { countT += dt; if (countT >= GAME.COUNTDOWN + 0.6) showCount(''); }
    if (state === 'play' && P) {
      playT += dt;
      const input = deps.input?.() || {};
      fireT -= dt;
      if (input.fire) { while (fireT <= 0) { fire(P); fireT += 1 / GAME.FIRE_RATE; } } else if (fireT < 0) fireT = 0;
      if (input.bomb && !prevBomb) dropBomb(P);
      prevBomb = !!input.bomb;
      ({ bombs, timer: regenT } = regenBombs(bombs, regenT, dt));
      const hit = crashTest(P);
      if (hit) crash(P, hit);
      else if (targets.length && targets.every((tg) => tg.state === 'down')) { state = 'over'; endKind = 'win'; endT = 0.9; deps.onChange?.(); }
    }
    stepBullets(dt); stepBombs(dt); stepTargets(dt); stepFalls(dt);
    stepPool(built.pools.glow, dt); stepPool(built.pools.puff, dt); stepDebris(dt);
    if (state === 'over' && endEl.hidden && (endT -= dt) <= 0) { showEnd(); hideOverlays(); deps.onChange?.(); }
    camera.updateMatrixWorld();
    if (state !== 'over' || endEl.hidden) { syncHud(); stepAim(P); stepBars(); guide(P); }
  }
  function dispose() {
    exit();
    removeEventListener('keydown', onEndKeys, true);
    for (const n of [layer, hud, countEl, feedEl, endEl, warnEl, arrowEl, crossEl, panel]) n.remove();
    scene.remove(root);
    if (built) {
      for (const o of built.owned) o.dispose?.();
      root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      built = null;
    }
  }

  return {
    start, exit, playAgain, update, resync, dispose,
    /** 'idle' | 'countdown' | 'play' | 'over' */
    get state() { return state; },
    get active() { return state !== 'idle'; },
    debug: {
      stats: () => ({ state, endKind, crash: crashWhat, crashRepo, score, kills, total: targets.length, shots, hits, bombs, combo, time: +playT.toFixed(2),
        standing: targets.filter((t) => t.state === 'ok').length, crumbling: targets.filter((t) => t.state === 'crumbling').length, card: !endEl.hidden }),
      targets: () => targets.map((t) => ({ name: t.label, hp: t.hp, max: t.max, state: t.state, stage: t.stage, tiers: t.tiers.length, left: t.left,
        sink: +t.sink.toFixed(2), top: +t.top.toFixed(2), top0: +t.top0.toFixed(2), cx: t.cx, cz: t.cz, fw: t.fw, dealt: t.dealt })),
      /** Damage a building by name (or the first standing one), as if hit. */
      hit(name, amount = 1e9, kind = 'bomb') {
        const tg = targets.find((t) => t.state === 'ok' && (!name || t.label === name || t.name === name));
        if (tg) damage(tg, amount, tg.cx, tg.top * 0.5, tg.cz, kind);
        return !!tg;
      },
      killAll() { for (const tg of targets) if (tg.state === 'ok') damage(tg, 1e9, tg.cx, tg.top * 0.5, tg.cz, 'bomb'); },
      skipCountdown() { if (state === 'countdown') countT = GAME.COUNTDOWN; },
      bombs: () => (built ? built.bombs.filter((b) => b.live).map((b) => b.pos.toArray().map((v) => +v.toFixed(2))) : []),
      blasts: () => blastLog.slice(),
    },
  };
}
