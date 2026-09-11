/*
 * Git City attractions: the shared builder toolkit.
 *
 * Constants, tools(kit) (per-build geometry/material cache, ink hulls, vertex
 * paint, instanced beams, the day/night probe), bulb chasing, static batching
 * (bake/finish) and the blocky rider. Used by the builders in rides.js,
 * countryside.js and landmarks.js. No imports: THREE arrives through `kit`.
 */

export const TAU = Math.PI * 2;
export const noRay = () => {};
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth01 = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Shared builder toolkit (one per builder call, so geometries/materials are
// shared inside an attraction and disposed with it).
// ---------------------------------------------------------------------------
export function tools(kit) {
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
  // overall (matches city/toon.js outlineBox on boxes). Returns the body mesh.
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
export function chase(a, b, on, n) {
  const hi = 0.45 + 1.3 * n, lo = 0.12 + 0.25 * n;
  a.emissiveIntensity = on ? hi : lo;
  b.emissiveIntensity = on ? lo : hi;
}

// Belt-and-braces: nothing in an attraction may steal a click.
export function seal(group) {
  group.traverse((o) => { o.raycast = noRay; });
  return group;
}

// Static batching: under the root and under every animated node, merge all
// plain meshes that share a material into one mesh (transforms baked relative
// to that node). Ink hulls collapse to one draw per node, so an attraction
// costs a handful of draw calls instead of a hundred-plus. `dynamic` lists
// every Object3D that update() moves, rotates, scales or toggles; none of
// them may be the child of a mesh.
export function bake(THREE, root, dynamic) {
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
export function finish(T, group, dynamic = []) {
  bake(T.THREE, group, dynamic);
  return seal(group);
}

// A blocky rider: torso + head, optional raised arms. Returns the group.
export function rider(T, parent, x, y, z, rnd, armsUp = false) {
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
