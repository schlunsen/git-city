/*
 * Git City — procedural attractions + landmark objects for the island.
 *
 * No imports: the host passes THREE in through `kit`, so this module works in
 * any module context (and in attractions-preview.html) without a bare "three".
 *
 *   kit = { THREE, envMat, ink, rnd }
 *     envMat(nightHex, dayHex, extra?) -> MeshToonMaterial, colour lerped night->day by the host
 *     ink  : shared BackSide MeshBasicMaterial for inverted-hull outlines
 *     rnd  : seeded () => [0,1) — the ONLY source of randomness here
 *
 * Every builder returns { group, update(dt, elapsed), radius }. Each group is
 * built around the local origin, standing on y = 0 (+Y up), with footings that
 * reach down to about y = -1.5 so gently uneven ground never shows a gap.
 * update() only moves/rotates existing objects and tweaks a few uniforms —
 * no per-frame allocation, no geometry rebuilds. All meshes ignore raycasts.
 */

const TAU = Math.PI * 2;
const noRay = () => {};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Shared builder toolkit (one per builder call, so geometries/materials are
// shared inside an attraction and disposed with it).
// ---------------------------------------------------------------------------
function tools(kit) {
  const { THREE, envMat, ink, rnd } = kit;
  const NIGHT = new THREE.Color(0x2a3a4a);
  const _c = new THREE.Color();
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();

  // Night tint for a day colour: much darker, pulled toward the app's night blue.
  const nightOf = (day) => _c.setHex(day).multiplyScalar(0.1).lerp(NIGHT, 0.4).getHex();

  const mats = new Map();
  const mat = (day, extra) => {
    if (extra) return envMat(nightOf(day), day, extra);
    let m = mats.get(day);
    if (!m) { m = envMat(nightOf(day), day, {}); mats.set(day, m); }
    return m;
  };
  // Vertex-coloured toon material (stripes, gores, bands). Day white, so the
  // vertex colours read true by day and dim with the host's night lerp.
  let vcol = null;
  const vmat = () => vcol || (vcol = envMat(0x3a4050, 0xffffff, { vertexColors: true }));
  // Lamps/bulbs: emissive so they read at night; intensity animated by update().
  const glow = (hex, intensity = 1.2) => envMat(nightOf(hex), hex, { emissive: hex, emissiveIntensity: intensity });
  // Unlit (flames, smoke) — deliberately outside the day/night palette.
  const basic = (hex, extra = {}) => new THREE.MeshBasicMaterial({ color: hex, ...extra });

  const geos = new Map();
  const memo = (key, make) => { let g = geos.get(key); if (!g) { g = make(); geos.set(key, g); } return g; };
  const box = (w, h, d) => memo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  const cyl = (rt, rb, h, seg = 10, open = false) => memo(`c${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  const cone = (r, h, seg = 10) => memo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
  const ball = (r, ws = 10, hs = 7) => memo(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));

  const add = (parent, geo, material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.raycast = noRay;
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  // Inverted-hull ink: a BackSide child scaled so it grows ~t world units
  // overall (matches app.js outlineBox on boxes). Returns the body mesh.
  const hull = (m, t = 0.22) => {
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    g.boundingBox.getSize(_v); g.boundingBox.getCenter(_w);
    const h = new THREE.Mesh(g, ink);
    h.raycast = noRay;
    const sx = _v.x > 1e-3 ? (_v.x + t) / _v.x : 1;
    const sy = _v.y > 1e-3 ? (_v.y + t) / _v.y : 1;
    const sz = _v.z > 1e-3 ? (_v.z + t) / _v.z : 1;
    h.scale.set(sx, sy, sz);
    h.position.set(_w.x * (1 - sx), _w.y * (1 - sy), _w.z * (1 - sz));
    m.add(h);
    return m;
  };
  const inked = (parent, geo, material, x, y, z, t) => hull(add(parent, geo, material, x, y, z), t);

  // Paint a geometry with per-face vertex colours. `pick(angle, y, face)`
  // returns a hex; angle is the CylinderGeometry/LatheGeometry theta (0 at +Z).
  const paint = (geo, pick) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 3; k++) { x += p.getX(i + k); y += p.getY(i + k); z += p.getZ(i + k); }
      const a = (Math.atan2(x, z) + TAU) % TAU;
      _c.setHex(pick(a, y / 3, i / 3));
      for (let k = 0; k < 3; k++) { col[(i + k) * 3] = _c.r; col[(i + k) * 3 + 1] = _c.g; col[(i + k) * 3 + 2] = _c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const stripes = (geo, n, colors) => paint(geo, (a) => colors[Math.floor((a / TAU) * n + 1e-4) % colors.length]);

  // Instanced beams between point pairs (lattices, supports, tethers-at-rest).
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _d = new THREE.Vector3();
  const _Y = new THREE.Vector3(0, 1, 0);
  const beams = (parent, segs, r, material, { radial = 5, inkT = 0, colors = null } = {}) => {
    const geo = new THREE.CylinderGeometry(r, r, 1, radial, 1, false).translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(geo, material, segs.length);
    const hm = inkT ? new THREE.InstancedMesh(new THREE.CylinderGeometry(r + inkT, r + inkT, 1, radial, 1, true).translate(0, 0.5, 0), ink, segs.length) : null;
    segs.forEach(([a, b], i) => {
      _d.subVectors(b, a);
      const len = _d.length();
      _q.setFromUnitVectors(_Y, _d.normalize());
      _m4.compose(a, _q, _s.set(1, len, 1));
      im.setMatrixAt(i, _m4);
      if (hm) hm.setMatrixAt(i, _m4);
      if (colors) im.setColorAt(i, _c.setHex(colors[i % colors.length]));
    });
    im.raycast = noRay; im.castShadow = true; im.receiveShadow = true;
    parent.add(im);
    if (hm) { hm.raycast = noRay; parent.add(hm); }
    return im;
  };

  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // Day/night probe: an envMat that is never drawn. The host lerps its colour
  // black->white with everything else, so colour.r IS the day factor — lamps
  // can brighten at night without widening the builder interface.
  const probe = envMat(0x000000, 0xffffff, {});
  const night = () => 1 - clamp(probe.color.r, 0, 1);

  return { THREE, rnd, ink, mat, vmat, glow, basic, box, cyl, cone, ball, memo, add, hull, inked, paint, stripes, beams, pick, V, night };
}

// Two interleaved bulb sets: swap bright/dim, brighter overall at night.
function chase(a, b, on, n) {
  const hi = 0.45 + 1.3 * n, lo = 0.12 + 0.25 * n;
  a.emissiveIntensity = on ? hi : lo;
  b.emissiveIntensity = on ? lo : hi;
}

// Belt-and-braces: nothing in an attraction may steal a click.
function seal(group) {
  group.traverse((o) => { o.raycast = noRay; });
  return group;
}

// Static batching: under the root and under every animated node, merge all
// plain meshes that share a material into one mesh (transforms baked relative
// to that node). Ink hulls collapse to one draw per node, so an attraction
// costs a handful of draw calls instead of a hundred-plus. `dynamic` lists
// every Object3D that update() moves, rotates, scales or toggles; none of
// them may be the child of a mesh.
function bake(THREE, root, dynamic) {
  const dyn = new Set(dynamic);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  for (const box of [root, ...dynamic]) {
    inv.copy(box.matrixWorld).invert();
    const buckets = new Map();
    const visit = (o) => {
      for (const ch of o.children) {
        if (dyn.has(ch)) continue;
        if (ch.isMesh && !ch.isInstancedMesh && ch.visible) {
          let b = buckets.get(ch.material);
          if (!b) { b = []; buckets.set(ch.material, b); }
          b.push(ch);
        }
        visit(ch);
      }
    };
    visit(box);
    for (const [material, meshes] of buckets) {
      if (meshes.length < 2) continue;
      const withColor = !!material.vertexColors;
      let verts = 0, tris = 0;
      for (const m of meshes) {
        verts += m.geometry.attributes.position.count;
        tris += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
      }
      const pos = new Float32Array(verts * 3), nrm = new Float32Array(verts * 3), col = withColor ? new Float32Array(verts * 3) : null;
      const idx = new (verts > 65535 ? Uint32Array : Uint16Array)(tris);
      let base = 0, ii = 0, cast = false, recv = false;
      for (const m of meshes) {
        const g = m.geometry, p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
        rel.multiplyMatrices(inv, m.matrixWorld);
        nm.getNormalMatrix(rel);
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(rel);
          pos[(base + i) * 3] = v.x; pos[(base + i) * 3 + 1] = v.y; pos[(base + i) * 3 + 2] = v.z;
          if (n) v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); else v.set(0, 1, 0);
          nrm[(base + i) * 3] = v.x; nrm[(base + i) * 3 + 1] = v.y; nrm[(base + i) * 3 + 2] = v.z;
          if (col) {
            col[(base + i) * 3] = c ? c.getX(i) : 1; col[(base + i) * 3 + 1] = c ? c.getY(i) : 1; col[(base + i) * 3 + 2] = c ? c.getZ(i) : 1;
          }
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) idx[ii++] = base + g.index.getX(i);
        else for (let i = 0; i < p.count; i++) idx[ii++] = base + i;
        base += p.count;
        cast ||= m.castShadow; recv ||= m.receiveShadow;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const merged = new THREE.Mesh(geo, material);
      merged.castShadow = cast; merged.receiveShadow = recv;
      for (const m of meshes) m.parent?.remove(m);
      box.add(merged);
    }
  }
  // Drop the now-empty helper groups left behind.
  const prune = (o) => {
    for (const ch of [...o.children]) {
      prune(ch);
      if (!ch.isMesh && !ch.isInstancedMesh && !dyn.has(ch) && ch.children.length === 0) o.remove(ch);
    }
  };
  prune(root);
  return root;
}
function finish(T, group, dynamic = []) {
  bake(T.THREE, group, dynamic);
  return seal(group);
}

// A blocky rider: torso + head, optional raised arms. Returns the group.
function rider(T, parent, x, y, z, rnd, armsUp = false) {
  const g = new T.THREE.Group();
  g.position.set(x, y, z);
  const shirt = T.mat(T.pick([0x3abeff, 0xffa03a, 0x8c78ff, 0x64dedb, 0xef6f6c, 0xf4d35e]));
  const skin = T.mat(T.pick([0xf2c9a0, 0xd9a47a, 0x9c6b4a, 0xf5d6b8]));
  T.add(g, T.box(0.38, 0.42, 0.28), shirt, 0, 0.21, 0);
  T.add(g, T.ball(0.2, 8, 6), skin, 0, 0.62, 0);
  if (armsUp) {
    const l = T.add(g, T.box(0.1, 0.46, 0.1), shirt, -0.22, 0.6, 0); l.rotation.z = 0.35;
    const r = T.add(g, T.box(0.1, 0.46, 0.1), shirt, 0.22, 0.6, 0); r.rotation.z = -0.35;
  }
  parent.add(g);
  return g;
}

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
// Registry — pick deterministically with the seeded rnd. `radius` is the
// footprint radius (world units); `tags` say where on the island each belongs:
//   fair  — funfair cluster      farm — fields/villages     coast — near the shore
//   hill  — high ground          wild — away from roads
//   flat  — wide footprint that wants near-level ground (> ~1.5 u of relief
//           across it will float or bury an edge)
// windTurbines additionally exposes group.userData.snap: the three turbine
// roots, each safe to terrain-snap on its own.
// ===========================================================================
export const ATTRACTIONS = [
  { key: 'rollerCoaster', build: buildRollerCoaster, radius: 18, weight: 1, tags: ['fair', 'flat'] },
  { key: 'carousel', build: buildCarousel, radius: 5.6, weight: 2, tags: ['fair'] },
  { key: 'circusTent', build: buildCircusTent, radius: 8.4, weight: 1.5, tags: ['fair', 'flat'] },
  { key: 'dropTower', build: buildDropTower, radius: 4, weight: 1, tags: ['fair'] },
  { key: 'windTurbines', build: buildWindTurbines, radius: 15, weight: 1, tags: ['hill', 'coast', 'farm'] },
  { key: 'windmill', build: buildWindmill, radius: 5, weight: 1.5, tags: ['farm', 'hill'] },
  { key: 'farm', build: buildFarm, radius: 12, weight: 1.5, tags: ['farm', 'flat'] },
  { key: 'campsite', build: buildCampsite, radius: 7, weight: 1.5, tags: ['wild', 'coast', 'flat'] },
  { key: 'radioTower', build: buildRadioTower, radius: 5, weight: 1, tags: ['hill', 'wild'] },
  { key: 'observatory', build: buildObservatory, radius: 5.5, weight: 1, tags: ['hill'] },
  { key: 'balloonPad', build: buildBalloonPad, radius: 5.5, weight: 1, tags: ['hill', 'farm', 'fair'] },
];
