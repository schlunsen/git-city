// ---------------------------------------------------------------------------
// explore.js — walk, drive and fly through Git City.
//
// createExplorer(THREE, deps) layers three camera modes over the app's
// OrbitControls view:
//   walk  — first person: WASD / arrows, mouse look (pointer lock, or drag when
//           the lock is unavailable), Shift to run, Space to jump. Collides with
//           the building boxes and stays on the island.
//   drive — a cel-shaded toon car on the boulevard ring. Arcade physics
//           (throttle, drag, speed-scaled steering, slip / drift), follows and
//           tilts to the terrain, bumps off buildings, smooth chase camera,
//           headlights at night.
//   fly   — a toon biplane with a spinning prop: pitch, bank-to-turn, throttle,
//           auto-levelling, a floor over terrain and roofs, a soft world bound
//           and a puffy contrail.
// While a mode is active — and while the camera glides back to the orbit view
// afterwards — `ownsCamera` is true (update() returns it too): the host must
// then skip its own camera logic (tour, flyover, follow, controls.update()).
// Vehicles, HUD, touch controls and puffs all live here; the CSS is injected.
// ---------------------------------------------------------------------------

const MODES = ['orbit', 'walk', 'drive', 'fly'];
const LABEL = { orbit: 'Orbit', walk: 'Walk', drive: 'Drive', fly: 'Fly' };
const EYE = 1.65, PLAYER_R = 0.45, WALK_SPEED = 5.2, RUN_SPEED = 11, JUMP_V = 7.4, GRAVITY = 22;
const SEA_LIMIT = -0.9;      // heightAt below this is water: no walking or driving
const SEA_Y = -1.25;         // the sea plane, the plane's floor over water
const BOX_PAD = 0.3;         // grow building boxes past the roof overhang and ink rim
const CAR = { L: 3.0, W: 1.62, WR: 0.42, WB: 1.9, TRACK: 1.4, R: 0.8, AXLE: 0.66, MAXF: 26, MAXR: 8, ACC: 15, BRAKE: 32 };
const PLANE = { MIN: 11, MAX: 54, FLOOR: 2.6, SOFT_R: 330, HARD_R: 430, CEIL: 190 };
const TO_M = 1.6;            // world units -> metres for the HUD (a 3-unit car is ~4.8 m)
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (dt, rate) => 1 - Math.exp(-dt * rate);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const noRaycast = () => {};

export function createExplorer(THREE, deps = {}) {
  const { scene, camera, renderer, controls, onModeChange } = deps;
  if (!scene || !camera || !renderer) throw new Error('createExplorer: scene, camera and renderer are required');
  const canvas = renderer.domElement;
  const heightAt = deps.heightAt || (() => 0);
  const colliders = deps.colliders || (() => []);
  const dayFactor = deps.dayFactor || (() => 1);
  // City layout (defaults mirror app.js: paved slab, boulevard ring, plaza).
  const SLAB = { half: deps.slabHalf ?? 56.5, r: deps.slabRadius ?? 15, y: 0.09 };
  const RING = { half: deps.ringHalf ?? 49.5, corner: deps.ringCorner ?? 8 };
  const CELL = deps.cell ?? 9;
  const PLAZA = { r: deps.plazaRadius ?? 15.3, y: 0.14 };
  // Round obstacles: the fountain pool around the monument and the four planters.
  const obstacles = deps.obstacles ?? [{ x: 0, z: 0, r: 7.4 },
    ...[1, 3, 5, 7].map((k) => ({ x: Math.cos(k * Math.PI / 4) * 13.8, z: Math.sin(k * Math.PI / 4) * 13.8, r: 1.2 }))];
  const reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const UP = new THREE.Vector3(0, 1, 0), ZAXIS = new THREE.Vector3(0, 0, 1);
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const _e = new THREE.Euler(), _ray = new THREE.Ray(), _hit = new THREE.Vector3(), _c = new THREE.Vector3();

  // ---- ground ---------------------------------------------------------------
  // Live city footprint (app.js cityLayout): dist(x, z) < 0 inside the boulevard
  // centreline, the slab edge SIDEWALK beyond it; contour(offset) / streets give
  // spawn points. Without one we fall back to the classic rounded square.
  const SIDEWALK = SLAB.half - RING.half;
  function getLayout() {
    try { const L = deps.layout?.(); return L && typeof L.dist === 'function' ? L : null; } catch { return null; }
  }
  function sdSlab(x, z) {
    const L = getLayout();
    if (L) return L.dist(x, z) - SIDEWALK;
    const k = SLAB.half - SLAB.r, qx = Math.abs(x) - k, qz = Math.abs(z) - k;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - SLAB.r;
  }
  function groundAt(x, z) {
    let h = heightAt(x, z);
    if (sdSlab(x, z) <= 0) h = Math.max(h, x * x + z * z < PLAZA.r * PLAZA.r ? PLAZA.y : SLAB.y);
    return h;
  }
  const onLand = (x, z) => sdSlab(x, z) <= 0.4 || heightAt(x, z) > SEA_LIMIT;
  // Horizontal direction pointing inland (uphill), for bouncing off the shore.
  function landNormal(x, z, out) {
    const e = 1.5, gx = heightAt(x + e, z) - heightAt(x - e, z), gz = heightAt(x, z + e) - heightAt(x, z - e);
    const l = Math.hypot(gx, gz);
    if (l > 1e-4) return out.set(gx / l, 0, gz / l);
    const r = Math.hypot(x, z) || 1;
    return out.set(-x / r, 0, -z / r);
  }

  // ---- colliders: one padded Box3 per building body, cached per city --------
  let boxes = null, needUnstick = false;
  function getBoxes() {
    if (boxes) return boxes;
    boxes = [];
    let list = [];
    try { list = colliders() || []; } catch { list = []; }
    for (const o of list) {
      if (!o) continue;
      o.updateWorldMatrix(true, false);
      const b = new THREE.Box3().setFromObject(o);
      if (b.isEmpty()) continue;
      b.min.x -= BOX_PAD; b.min.z -= BOX_PAD; b.max.x += BOX_PAD; b.max.z += BOX_PAD; b.max.y += 0.7; // roof cap
      boxes.push(b);
    }
    return boxes;
  }
  // Push circle (p.x, p.z, r) out of every box overlapping [y0, y1] and out of
  // the round obstacles. Moves p in place; returns the summed push normal in
  // `hitN` (x, z) and true when anything was hit.
  const hitN = new THREE.Vector3();
  function collide(p, r, y0, y1, withObstacles = true) {
    let nx = 0, nz = 0, hit = false;
    for (const b of getBoxes()) {
      if (b.max.y < y0 || b.min.y > y1) continue;
      if (p.x < b.min.x - r || p.x > b.max.x + r || p.z < b.min.z - r || p.z > b.max.z + r) continue;
      const cx = clamp(p.x, b.min.x, b.max.x), cz = clamp(p.z, b.min.z, b.max.z);
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        if (d >= r) continue;
        const k = (r - d) / d;
        p.x += dx * k; p.z += dz * k; nx += dx / d; nz += dz / d;
      } else { // centre inside the box: leave by the nearest side
        const l = p.x - b.min.x, rr = b.max.x - p.x, bk = p.z - b.min.z, f = b.max.z - p.z, m = Math.min(l, rr, bk, f);
        if (m === l) { p.x = b.min.x - r; nx -= 1; } else if (m === rr) { p.x = b.max.x + r; nx += 1; }
        else if (m === bk) { p.z = b.min.z - r; nz -= 1; } else { p.z = b.max.z + r; nz += 1; }
      }
      hit = true;
    }
    if (withObstacles && y0 < 3) {
      for (const o of obstacles) {
        const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), rr = o.r + r;
        if (d >= rr || d < 1e-6) continue;
        p.x = o.x + dx / d * rr; p.z = o.z + dz / d * rr; nx += dx / d; nz += dz / d; hit = true;
      }
    }
    const l = Math.hypot(nx, nz) || 1;
    hitN.set(nx / l, 0, nz / l);
    return hit;
  }
  // First box hit by the segment from -> to (for keeping chase cams out of walls).
  function segmentHit(from, to) {
    _v2.subVectors(to, from);
    const len = _v2.length();
    if (len < 1e-4) return len;
    _ray.set(from, _v2.divideScalar(len));
    let best = len;
    for (const b of getBoxes()) {
      if (_ray.intersectBox(b, _hit)) { const d = _hit.distanceTo(from); if (d < best) best = d; }
    }
    return best;
  }

  // ---- materials + geometry helpers -----------------------------------------
  const ink = deps.ink || new THREE.MeshBasicMaterial({ color: 0x0a0d16, side: THREE.BackSide });
  const ownedMats = []; // materials this module created itself (envMat ones belong to the host palette)
  let ramp = null;
  function toon(hex, extra = {}) {
    if (deps.envMat) return deps.envMat(hex, hex, extra); // same cel ramp as the city; night == day colour
    if (!ramp) {
      ramp = new THREE.DataTexture(new Uint8Array([98, 98, 98, 255, 152, 152, 152, 255, 218, 218, 218, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
      ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
    }
    const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp, ...extra });
    ownedMats.push(m);
    return m;
  }
  const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
  // Inverted-hull ink copy of a part, grown by about t overall.
  function hullOf(g, t) {
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3()), s = g.boundingBox.getSize(new THREE.Vector3());
    return g.clone().translate(-c.x, -c.y, -c.z)
      .scale((s.x + t) / Math.max(s.x, 1e-3), (s.y + t) / Math.max(s.y, 1e-3), (s.z + t) / Math.max(s.z, 1e-3)).translate(c.x, c.y, c.z);
  }
  function part(parent, geo, mat, hull = 0, shadow = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.raycast = noRaycast;
    parent.add(m);
    if (hull) { const h = new THREE.Mesh(hullOf(geo, hull), ink); h.raycast = noRaycast; parent.add(h); }
    return m;
  }
  // Side profile (x = length, y = height) with rounded corners, extruded across z.
  function sideExtrude(pts, radii, width, bevel = 0) {
    const s = new THREE.Shape(), n = pts.length;
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i], [ax, ay] = pts[(i + n - 1) % n], [bx, by] = pts[(i + 1) % n];
      const r = radii[i] || 0, da = Math.hypot(ax - px, ay - py), db = Math.hypot(bx - px, by - py);
      const ka = Math.min(r, da / 2) / da, kb = Math.min(r, db / 2) / db;
      const sx = px + (ax - px) * ka, sy = py + (ay - py) * ka;
      if (i === 0) s.moveTo(sx, sy); else s.lineTo(sx, sy);
      if (r > 0) s.quadraticCurveTo(px, py, px + (bx - px) * kb, py + (by - py) * kb);
    }
    s.closePath();
    const depth = Math.max(0.01, width - 2 * bevel);
    return new THREE.ExtrudeGeometry(s, {
      depth, curveSegments: 6, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3,
    }).translate(0, 0, -depth / 2);
  }
  // Top-view rounded slab (wings, stabilisers): chord along x, span along z.
  function planform(chord, span, r, thick) {
    const s = new THREE.Shape(), hx = chord / 2, hz = span / 2;
    s.moveTo(-hx + r, -hz); s.lineTo(hx - r, -hz); s.quadraticCurveTo(hx, -hz, hx, -hz + r);
    s.lineTo(hx, hz - r); s.quadraticCurveTo(hx, hz, hx - r, hz); s.lineTo(-hx + r, hz);
    s.quadraticCurveTo(-hx, hz, -hx, hz - r); s.lineTo(-hx, -hz + r); s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
    return new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 2, curveSegments: 6 })
      .rotateX(-Math.PI / 2).translate(0, -thick / 2, 0);
  }
  let blobTex = null;
  function blobMaterial() {
    if (!blobTex) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
      g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      blobTex = new THREE.CanvasTexture(cv);
    }
    const m = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    ownedMats.push(m);
    return m;
  }

  // ---- the toon car (local frame: +x forward, y up, +z right) ---------------
  let carObj = null;
  function buildCar() {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const { L, W, WR } = CAR, x0 = -L / 2, x1 = L / 2, y0 = 0.36, y1 = 0.98;
    const paint = toon(0xef5b4c), cream = toon(0xf6efe1), trim = toon(0x2a2f3a), glass = toon(0x9ad3ea);
    const chrome = toon(0xcfd5de), tyre = toon(0x1d212b), teal = toon(0x64dedb, { emissive: 0x64dedb, emissiveIntensity: 0.3 });
    const lamp = toon(0xfff6d8, { emissive: 0xffe2a0, emissiveIntensity: 0.3 });
    const tail = toon(0xe0443e, { emissive: 0xff3b30, emissiveIntensity: 0.3 });
    // Chunky tub with a rounded hood and a bubble cabin: a cartoon coupe.
    part(body, sideExtrude([[x0, y0], [x1, y0], [x1, 0.84], [x1 - 0.62, y1], [x0 + 0.1, y1], [x0, 0.88]],
      [0.18, 0.2, 0.2, 0.34, 0.3, 0.2], W, 0.09), paint, 0.16);
    const cb = { rb: x0 + 0.4, fb: 0.52, rt: x0 + 0.66, ft: 0.02, top: 1.64 };
    part(body, sideExtrude([[cb.rb, y1 - 0.04], [cb.fb, y1 - 0.04], [cb.ft, cb.top], [cb.rt, cb.top]], [0, 0, 0.26, 0.3], W - 0.28, 0.05), glass, 0.12);
    part(body, sideExtrude([[cb.rt - 0.08, cb.top - 0.09], [cb.ft + 0.1, cb.top - 0.09], [cb.ft + 0.02, cb.top + 0.07], [cb.rt, cb.top + 0.07]],
      [0.02, 0.02, 0.1, 0.1], W - 0.2, 0.05), cream, 0.08);
    part(body, box(0.14, cb.top - y1, W - 0.22, -0.34, (cb.top + y1) / 2, 0), paint);              // B pillar
    part(body, box(L - 0.5, 0.1, 0.05, -0.05, 0.62, W / 2 + 0.06), cream, 0, false);               // side stripes
    part(body, box(L - 0.5, 0.1, 0.05, -0.05, 0.62, -W / 2 - 0.06), cream, 0, false);
    for (const s of [-1, 1]) {
      part(body, cyl(0.2, 0.2, 0.08, 18).rotateZ(Math.PI / 2).translate(x1 + 0.06, 0.66, s * 0.46), chrome, 0.07); // bug-eye rims
      part(body, cyl(0.15, 0.15, 0.09, 18).rotateZ(Math.PI / 2).translate(x1 + 0.1, 0.66, s * 0.46), lamp, 0, false);
      part(body, box(0.06, 0.13, 0.3, x0 - 0.07, 0.72, s * 0.5), tail, 0, false);
      part(body, box(0.16, 0.12, 0.12, 0.42, 1.06, s * (W / 2 + 0.02)), paint, 0.07);               // mirrors
    }
    for (const bx of [x1 + 0.1, x0 - 0.1]) part(body, box(0.18, 0.2, W + 0.02, bx, y0 + 0.08, 0), trim, 0.08); // bumpers
    part(body, cyl(0.025, 0.025, 0.75, 5).translate(x0 + 0.35, y1 + 0.37, -0.52), trim, 0, false);  // antenna
    part(body, new THREE.SphereGeometry(0.09, 10, 8).translate(x0 + 0.35, y1 + 0.76, -0.52), teal, 0.05, false);
    const wheels = [];
    for (const [x, front] of [[CAR.WB / 2, true], [-CAR.WB / 2, false]]) for (const s of [-1, 1]) {
      const steer = new THREE.Group(), spin = new THREE.Group();
      steer.position.set(x, WR, s * (W / 2 - 0.04));
      steer.add(spin);
      part(spin, cyl(WR, WR, 0.34, 20).rotateX(Math.PI / 2), tyre, 0.1);
      part(spin, cyl(0.22, 0.22, 0.36, 12).rotateX(Math.PI / 2), chrome, 0, false);
      part(spin, box(0.07, 0.34, 0.37), trim, 0, false); // a spoke, so the roll reads
      root.add(steer);
      wheels.push({ steer, spin, front });
    }
    // Night headlight pools: an additive trapezoid on the road, like the city traffic.
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.07, -0.55, 0, 0.07, 0.55, 7, 0.07, 2.2, 7, 0.07, -2.2], 3));
    beamGeo.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.9, 0.7, 1, 0.9, 0.7, 0, 0, 0, 0, 0, 0], 3));
    beamGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    ownedMats.push(beamMat);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.x = x1; beam.raycast = noRaycast;
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.9, W + 0.9).rotateX(-Math.PI / 2), blobMaterial());
    blob.position.y = 0.04; blob.raycast = noRaycast;
    root.add(beam, blob);
    return { root, body, wheels, lamp, tail, beamMat };
  }

  // ---- the toon biplane (local frame: +x forward, y up, +z right) -----------
  let planeObj = null;
  function buildPlane() {
    const root = new THREE.Group();
    const red = toon(0xef5b4c), cream = toon(0xf6efe1), trim = toon(0x2a2f3a), yellow = toon(0xf6c343), wood = toon(0x9a6a4a);
    const glass = toon(0x9ad3ea), skin = toon(0xf2c9a0), leather = toon(0x7a5236), teal = toon(0x64dedb);
    const prof = [[0.001, -2.75], [0.14, -2.7], [0.3, -2.2], [0.5, -1.2], [0.64, -0.2], [0.68, 0.7], [0.64, 1.45], [0.6, 1.62], [0.001, 1.62]];
    const fus = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24).rotateZ(-Math.PI / 2).scale(1, 1.06, 0.94);
    part(root, fus, red, 0.18);
    part(root, cyl(0.58, 0.66, 0.46, 24).rotateZ(-Math.PI / 2).translate(1.78, 0, 0), trim, 0.1);                  // cowling
    part(root, planform(1.35, 7.6, 0.55, 0.12).translate(0.45, 1.14, 0), cream, 0.12);                           // top wing
    part(root, planform(1.25, 7.0, 0.5, 0.12).translate(0.55, -0.42, 0), cream, 0.12);                           // lower wing
    for (const s of [-1, 1]) {
      part(root, new THREE.CircleGeometry(0.44, 24).rotateX(-Math.PI / 2).translate(0.45, 1.245, s * 2.85), teal, 0, false); // roundels
      part(root, new THREE.CircleGeometry(0.2, 20).rotateX(-Math.PI / 2).translate(0.45, 1.25, s * 2.85), cream, 0, false);
      for (const x of [0.12, 0.82]) {
        part(root, cyl(0.045, 0.045, 1.56, 6).translate(x, 0.36, s * 2.65), trim, 0.05);                         // interplane struts
        part(root, cyl(0.04, 0.04, 0.6, 6).translate(x, 0.84, s * 0.42), trim, 0, false);                       // cabane struts
      }
      part(root, cyl(0.035, 0.035, 0.75, 6).translate(0.75, -0.95, s * 0.7), trim, 0, false);                   // gear legs
      part(root, cyl(0.3, 0.3, 0.16, 16).rotateX(Math.PI / 2).translate(0.75, -1.3, s * 0.78), trim, 0.07);
      part(root, cyl(0.12, 0.12, 0.18, 10).rotateX(Math.PI / 2).translate(0.75, -1.3, s * 0.78), cream, 0, false);
    }
    const navL = toon(0xff5a4e, { emissive: 0xff3b30, emissiveIntensity: 0.6 }), navR = toon(0x5be08a, { emissive: 0x2fd06a, emissiveIntensity: 0.6 });
    part(root, new THREE.SphereGeometry(0.11, 10, 8).translate(0.45, 1.14, -3.82), navL, 0.05, false);
    part(root, new THREE.SphereGeometry(0.11, 10, 8).translate(0.45, 1.14, 3.82), navR, 0.05, false);
    part(root, planform(0.85, 2.8, 0.35, 0.08).translate(-2.35, 0.12, 0), cream, 0.1);                           // stabiliser
    part(root, sideExtrude([[-2.9, 0.15], [-1.95, 0.15], [-2.5, 1.22], [-2.92, 1.2]], [0, 0, 0.2, 0.2], 0.1, 0.03), red, 0.1); // fin
    part(root, box(0.5, 0.05, 0.06, -2.45, -0.36, 0).rotateZ(0), trim, 0, false);                                // tail skid
    // Open cockpit with a little pilot: leather cap, goggles, fluttering teal scarf.
    part(root, new THREE.TorusGeometry(0.34, 0.06, 8, 20).rotateX(Math.PI / 2).translate(-0.78, 0.66, 0), trim, 0, false);
    part(root, box(0.04, 0.26, 0.52, -0.38, 0.8, 0).rotateZ(0), glass, 0.05, false);                              // windscreen
    part(root, new THREE.SphereGeometry(0.26, 16, 12).translate(-0.78, 0.92, 0), skin, 0.07);
    part(root, new THREE.SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.8, 0.95, 0), leather, 0, false);
    for (const s of [-1, 1]) part(root, cyl(0.075, 0.075, 0.07, 12).rotateZ(Math.PI / 2).translate(-0.53, 0.97, s * 0.11), glass, 0.04, false);
    const scarf = new THREE.Group();
    scarf.position.set(-0.98, 0.76, 0.08);
    part(scarf, box(0.62, 0.07, 0.14, -0.31, 0, 0), teal, 0.04, false);
    root.add(scarf);
    // Propeller: spinner + two blades, plus a faint blur disc when it's fast.
    const prop = new THREE.Group();
    prop.position.x = 2.04;
    part(prop, new THREE.ConeGeometry(0.24, 0.5, 16).rotateZ(-Math.PI / 2).translate(0.22, 0, 0), yellow, 0.06);
    part(prop, box(0.07, 2.2, 0.22), wood, 0.06, false);
    for (const s of [-1, 1]) part(prop, box(0.075, 0.26, 0.23, 0, s * 0.98, 0), yellow, 0, false);
    const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    ownedMats.push(discMat);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32).rotateY(Math.PI / 2), discMat);
    disc.position.x = 2.08; disc.raycast = noRaycast;
    root.add(prop, disc);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(8, 6).rotateX(-Math.PI / 2), blobMaterial());
    blob.raycast = noRaycast;
    return { root, prop, discMat, scarf, blob, navL, navR };
  }

  // ---- puffs: cartoon smoke balls (contrail, tyre smoke, bonks) -------------
  const PUFF_N = 90;
  let puffs = null;
  function getPuffs() {
    if (puffs) return puffs;
    const geo = new THREE.IcosahedronGeometry(0.5, 1);
    const mesh = new THREE.InstancedMesh(geo, toon(0xffffff), PUFF_N);
    const inkMesh = new THREE.InstancedMesh(geo, ink, PUFF_N);
    mesh.frustumCulled = inkMesh.frustumCulled = false;
    mesh.raycast = inkMesh.raycast = noRaycast;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), col = new THREE.Color();
    for (let i = 0; i < PUFF_N; i++) { mesh.setMatrixAt(i, zero); inkMesh.setMatrixAt(i, zero); mesh.setColorAt(i, col.set(0xffffff)); }
    scene.add(mesh, inkMesh);
    puffs = { mesh, inkMesh, geo, data: Array.from({ length: PUFF_N }, () => ({ age: 1, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 })), next: 0, col, dirty: true };
    return puffs;
  }
  function puff(x, y, z, vx, vy, vz, size, hex, life = 1.4) {
    const P = getPuffs(), d = P.data[P.next];
    P.mesh.setColorAt(P.next, P.col.set(hex));
    P.mesh.instanceColor.needsUpdate = true;
    P.next = (P.next + 1) % PUFF_N;
    Object.assign(d, { age: 0, life, x, y, z, vx, vy, vz, s: size });
  }
  const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _ps = new THREE.Vector3(), _pp = new THREE.Vector3();
  function updatePuffs(dt) {
    if (!puffs) return;
    let live = false;
    for (let i = 0; i < PUFF_N; i++) {
      const d = puffs.data[i];
      if (d.age >= d.life) { if (d.life) { d.life = 0; puffs.mesh.setMatrixAt(i, _pm.makeScale(0, 0, 0)); puffs.inkMesh.setMatrixAt(i, _pm); live = true; } continue; }
      d.age += dt; live = true;
      const k = Math.exp(-dt * 1.8);
      d.vx *= k; d.vz *= k; d.vy = d.vy * k + 0.6 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const t = Math.min(1, d.age / d.life);
      _pp.set(d.x, d.y, d.z);
      // Shrink puffs that drift onto the lens, so the chase cam never sees a wall of white.
      const near = THREE.MathUtils.smoothstep(_pp.distanceTo(camera.position), 2.5, 8);
      const s = d.s * near * (t < 0.15 ? t / 0.15 : 1 - Math.pow((t - 0.15) / 0.85, 2)) * (0.7 + t * 0.6);
      puffs.mesh.setMatrixAt(i, _pm.compose(_pp, _pq, _ps.setScalar(Math.max(0, s))));
      puffs.inkMesh.setMatrixAt(i, _pm.compose(_pp, _pq, _ps.setScalar(Math.max(0, s) * 1.2)));
    }
    if (live) { puffs.mesh.instanceMatrix.needsUpdate = true; puffs.inkMesh.instanceMatrix.needsUpdate = true; }
  }

  // ---- state ------------------------------------------------------------------
  let mode = 'orbit';
  let sim = null;         // 'walk' | 'drive' | 'fly' — keeps running through the exit glide
  let exiting = false;    // gliding back to the saved orbit view
  let saved = null;       // { pos, target, fov, autoRotate }
  let blend = null;       // { t, dur, pos, quat, fov } camera transition start
  const want = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 50, look: new THREE.Vector3() };
  const walker = { p: new THREE.Vector3(), v: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, grounded: true, bob: 0, fov: 70 };
  const car = { p: new THREE.Vector3(), v: new THREE.Vector2(), yaw: 0, y: 0, pitch: 0, roll: 0, steer: 0, lean: 0, squat: 0, spin: 0, bump: 0, vf: 0, vl: 0, lastVf: 0, puffT: 0 };
  const plane = { p: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 26, throttle: 0.45, prop: 0, puffT: 0, bump: 0 };
  const chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, pitch: 0, idle: 9, zoom: { drive: 1, fly: 1 }, shake: 0 };

  // ---- input ---------------------------------------------------------------------
  const keys = new Set(), acts = new Set();
  const joy = { x: 0, y: 0, id: null };
  let locked = false, unlockedAt = -1e9, drag = null, sawTouch = false;
  const isTyping = (e) => !!e.target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  function onKeyDown(e) {
    if (isTyping(e) || e.metaKey || e.altKey) return;
    if (!e.ctrlKey && /^Digit[1-4]$/.test(e.code)) {
      setMode(MODES[Number(e.code.slice(5)) - 1]);
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      if (!menu.hidden) { closeMenu(); return; }
      // The first Esc only frees the mouse (the browser does that for us).
      if (mode !== 'orbit' && !locked && performance.now() - unlockedAt > 300) setMode('orbit');
      return;
    }
    if (mode === 'orbit') return;
    keys.add(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  }
  function onKeyUp(e) { keys.delete(e.code); if (mode !== 'orbit' && GAME_KEYS.has(e.code)) e.preventDefault(); }
  function clearInput() { keys.clear(); acts.clear(); joy.x = joy.y = 0; joy.id = null; drag = null; if (stickKnob) stickKnob.style.transform = ''; }
  const k = (...codes) => (codes.some((c) => keys.has(c)) ? 1 : 0);

  function look(dx, dy, sens) {
    if (mode === 'walk') {
      walker.yaw -= dx * sens;
      walker.pitch = clamp(walker.pitch - dy * sens, -1.45, 1.45);
    } else if (mode === 'drive' || mode === 'fly') {
      chase.yaw -= dx * sens;
      chase.pitch = clamp(chase.pitch + dy * sens, -0.35, 0.9);
      chase.idle = 0;
    }
  }
  // Explore modes own the canvas: pointer events never reach OrbitControls or
  // the app's building picker while a mode is active (window capture phase).
  function onPointerDown(e) {
    if (mode === 'orbit' || e.target !== canvas) return;
    e.stopPropagation();
    if (e.pointerType === 'touch' && !sawTouch) { sawTouch = true; syncUI(); }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, type: e.pointerType };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  }
  function onPointerMove(e) {
    if (mode === 'orbit' || e.target !== canvas) return;
    e.stopPropagation();
    if (locked || !drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    look(dx, dy, drag.type === 'touch' ? 0.006 : 0.0045);
  }
  function onPointerUp(e) {
    if (mode === 'orbit' || e.target !== canvas) return;
    e.stopPropagation();
    if (drag && drag.moved < 6 && mode === 'walk' && e.pointerType === 'mouse' && !locked) requestLock();
    drag = null;
  }
  function onMouseMove(e) { if (locked && mode === 'walk') look(e.movementX || 0, e.movementY || 0, 0.0022); }
  function requestLock() {
    try {
      const p = canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => { /* headless / denied: drag-to-look still works */ });
    } catch { /* unsupported */ }
  }
  function onLockChange() {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    if (was && !locked) unlockedAt = performance.now();
    syncUI();
  }
  function onWheel(e) {
    if (mode !== 'drive' && mode !== 'fly') return;
    chase.zoom[mode] = clamp(chase.zoom[mode] * (1 + Math.sign(e.deltaY) * 0.08), 0.6, 2.4);
  }
  function onBlur() { clearInput(); }

  // ---- DOM: HUD, mode menu, touch controls --------------------------------------
  injectStyle();
  const hud = el('div', 'gcx-hud', `
    <div class="gcx-seg" role="group" aria-label="Explore mode">
      <button type="button" data-mode="walk" title="Walk (2)">Walk</button>
      <button type="button" data-mode="drive" title="Drive (3)">Drive</button>
      <button type="button" data-mode="fly" title="Fly (4)">Fly</button>
    </div>
    <span class="gcx-hint"></span>
    <span class="gcx-gauge"></span>
    <button type="button" class="gcx-exit" title="Back to the orbit view (Esc)"><kbd>Esc</kbd> Exit</button>`);
  hud.hidden = true;
  const hintEl = hud.querySelector('.gcx-hint'), gaugeEl = hud.querySelector('.gcx-gauge');
  const menu = el('div', 'gcx-menu', MODES.map((m, i) =>
    `<button type="button" data-mode="${m}"><span>${LABEL[m]}</span><kbd>${i + 1}</kbd></button>`).join(''));
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const cross = el('div', 'gcx-cross', '');
  cross.hidden = true;
  const touch = el('div', 'gcx-touch', `
    <div class="gcx-stick" aria-hidden="true"><div class="gcx-knob"></div></div>
    <div class="gcx-acts"></div>`);
  touch.hidden = true;
  const stick = touch.querySelector('.gcx-stick'), stickKnob = touch.querySelector('.gcx-knob'), actsEl = touch.querySelector('.gcx-acts');
  document.body.append(hud, menu, cross, touch);
  const button = deps.button || document.getElementById('explore-btn');

  function el(tag, cls, html) { const n = document.createElement(tag); n.className = cls; n.innerHTML = html; return n; }
  const pick = (e) => {
    const b = e.target.closest?.('[data-mode]');
    if (!b) return;
    closeMenu();
    setMode(b.dataset.mode === mode && b.dataset.mode !== 'orbit' ? 'orbit' : b.dataset.mode);
    b.blur();
  };
  hud.addEventListener('click', (e) => {
    if (e.target.closest('.gcx-exit')) { setMode('orbit'); return; }
    pick(e);
  });
  // Keep taps on our own UI away from the host's "tap outside closes the menu" handler.
  for (const n of [hud, menu, touch]) n.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.addEventListener('click', pick);
  function openMenu() {
    if (!button) return;
    menu.hidden = false;
    const r = button.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    let top = r.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
    menu.style.top = `${top}px`;
    menu.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
    button.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() { menu.hidden = true; button?.setAttribute('aria-expanded', 'false'); }
  const onButton = (e) => { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu(); };
  if (button) { button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', onButton); }
  const onDocDown = (e) => { if (!menu.hidden && !menu.contains(e.target) && !button?.contains(e.target)) closeMenu(); };

  // Touch: one-thumb joystick + per-mode action buttons.
  const ACTS = { walk: [['jump', 'Jump'], ['run', 'Run']], drive: [['brake', 'Drift']], fly: [['faster', '+'], ['slower', '−']] };
  function moveJoy(e) {
    const r = stick.getBoundingClientRect(), R = r.width / 2 - 8;
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    joy.x = dx / R; joy.y = dy / R;
    stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  stick.addEventListener('pointerdown', (e) => { joy.id = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch { /* ok */ } moveJoy(e); e.preventDefault(); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) moveJoy(e); });
  const joyEnd = (e) => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; stickKnob.style.transform = ''; };
  stick.addEventListener('pointerup', joyEnd);
  stick.addEventListener('pointercancel', joyEnd);
  actsEl.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-act]'); if (b) { acts.add(b.dataset.act); b.classList.add('on'); e.preventDefault(); } });
  const actEnd = (e) => { const b = e.target.closest?.('[data-act]'); if (b) { acts.delete(b.dataset.act); b.classList.remove('on'); } };
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) actsEl.addEventListener(t, actEnd);

  const coarse = globalThis.matchMedia?.('(pointer: coarse)');
  const HINTS = {
    walk: () => (locked ? '<b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump · <b>Esc</b> free mouse'
      : '<b>WASD</b> move · <b>←→</b> turn · <b>Shift</b> run · <b>Space</b> jump · <b>click</b> to mouse-look'),
    drive: () => '<b>W/S</b> gas · brake · <b>A/D</b> steer · <b>Space</b> drift · drag to look',
    fly: () => '<b>S</b> climb · <b>W</b> dive · <b>A/D</b> bank · <b>E/Q</b> throttle',
  };
  function syncUI() {
    const on = mode !== 'orbit';
    hud.hidden = !on;
    document.body.classList.toggle('gcx-on', on);
    for (const b of hud.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    for (const b of menu.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    if (on) hintEl.innerHTML = HINTS[mode]();
    cross.hidden = !(mode === 'walk' && locked);
    const touchUI = on && (sawTouch || !!coarse?.matches);
    touch.hidden = !touchUI;
    hud.classList.toggle('gcx-touchy', touchUI);
    if (touchUI && actsEl.dataset.mode !== mode) {
      actsEl.dataset.mode = mode;
      actsEl.innerHTML = (ACTS[mode] || []).map(([a, t]) => `<button type="button" class="gcx-act" data-act="${a}">${t}</button>`).join('');
      acts.clear();
    }
    if (button) {
      button.classList.toggle('on', on);
      button.textContent = on ? LABEL[mode] : 'Explore';
    }
  }

  // ---- listeners ------------------------------------------------------------------
  const cap = { capture: true };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);
  addEventListener('pointerdown', onPointerDown, cap);
  addEventListener('pointermove', onPointerMove, cap);
  addEventListener('pointerup', onPointerUp, cap);
  document.addEventListener('pointerdown', onDocDown, cap);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('wheel', onWheel, { passive: true });

  // ---- spawning -----------------------------------------------------------------------
  // With a live layout: the long street whose outer end points most toward the
  // camera (stand just outside it, looking down the street) ...
  function layoutStreetEnd(cx, cz) {
    const L = getLayout();
    if (!L || !Array.isArray(L.streets)) return null;
    const cl = Math.hypot(cx, cz) || 1, ux = cx / cl, uz = cz / cl;
    let best = null, bestScore = -Infinity;
    for (const s of L.streets) {
      for (const [ex, ez, ox, oz] of [[s.x0, s.z0, s.x1, s.z1], [s.x1, s.z1, s.x0, s.z0]]) {
        const len = Math.hypot(ox - ex, oz - ez);
        if (!(len >= CELL * 3)) continue;
        const score = ex * ux + ez * uz - Math.abs(ex * uz - ez * ux) * 0.6;
        if (score > bestScore) { bestScore = score; best = { dx: (ox - ex) / len, dz: (oz - ez) / len, ex, ez }; }
      }
    }
    // Street ends sit on the boulevard centreline: step out onto the sidewalk (slab edge at SIDEWALK).
    const out = Math.min(4.5, SIDEWALK - 1.5);
    return best && { x: best.ex - best.dx * out, z: best.ez - best.dz * out, dx: best.dx, dz: best.dz };
  }
  // ... and the point of the boulevard's outer lane (the host's boulevardLane(L, 0.85)
  // resamples this same contour) on the camera's bearing, with its tangent.
  function layoutBoulevard(cx, cz) {
    const L = getLayout();
    let pts = null;
    try { pts = typeof L?.contour === 'function' ? L.contour(0.85) : null; } catch { pts = null; }
    if (!pts || pts.length < 8) return null;
    const N = pts.length, a = ((Math.atan2(cz, cx) / (Math.PI * 2)) % 1 + 1) % 1, k = Math.floor(a * N) % N;
    const p = pts[k], q = pts[(k + 2) % N], tl = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    return { x: p.x, z: p.z, tx: (q.x - p.x) / tl, tz: (q.z - p.z) / tl };
  }
  function spawnWalk() {
    const cx = camera.position.x, cz = camera.position.z, alongZ = Math.abs(cz) >= Math.abs(cx);
    const end = layoutStreetEnd(cx, cz);
    if (end) { walker.p.set(end.x, 0, end.z); walker.yaw = Math.atan2(-end.dx, -end.dz); }
    else {
      const blocks = Math.round((RING.half * 2) / CELL), streets = [];
      for (let i = 1; i < blocks; i++) streets.push((i - blocks / 2) * CELL);
      const lateral = (alongZ ? cx : cz) * 0.15;
      const street = streets.reduce((a, b) => (Math.abs(b - lateral) < Math.abs(a - lateral) ? b : a), streets[0] ?? 0);
      const edge = RING.half + 3, s = (alongZ ? cz : cx) >= 0 ? 1 : -1;
      if (alongZ) { walker.p.set(street, 0, s * edge); walker.yaw = s > 0 ? 0 : Math.PI; }
      else { walker.p.set(s * edge, 0, street); walker.yaw = s > 0 ? Math.PI / 2 : -Math.PI / 2; }
    }
    walker.pitch = 0.12; walker.v.set(0, 0, 0); walker.vy = 0; walker.grounded = true;
    collide(walker.p, PLAYER_R, 0.2, 1.8);
    walker.p.y = groundAt(walker.p.x, walker.p.z);
  }
  function spawnDrive() {
    const cx = camera.position.x, cz = camera.position.z, R = RING.half, straight = R - RING.corner - 3;
    const lane = layoutBoulevard(cx, cz);
    if (lane) { car.p.set(lane.x, 0, lane.z); car.yaw = Math.atan2(-lane.tz, lane.tx); }
    else if (Math.abs(cz) >= Math.abs(cx)) {
      const px = clamp(cx * 0.5, -straight, straight);
      car.p.set(px, 0, (cz >= 0 ? 1 : -1) * R); car.yaw = px > 0 ? Math.PI : 0;
    } else {
      const pz = clamp(cz * 0.5, -straight, straight);
      car.p.set((cx >= 0 ? 1 : -1) * R, 0, pz); car.yaw = pz > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    car.v.set(0, 0); car.steer = car.lean = car.squat = car.vf = car.vl = car.lastVf = car.bump = 0;
    unstickCar();
    car.y = groundAt(car.p.x, car.p.z);
    tiltCar(1);
    placeCar();
    chase.yaw = chase.pitch = 0; chase.idle = 9;
    driveCam(1, true);
  }
  function spawnFly() {
    camera.getWorldDirection(_v); _v.y = 0;
    if (_v.lengthSq() < 1e-6) _v.set(-1, 0, 0);
    _v.normalize();
    plane.yaw = Math.atan2(-_v.z, _v.x);
    plane.p.copy(camera.position).addScaledVector(_v, 14);
    plane.p.y -= 4;
    const r = Math.hypot(plane.p.x, plane.p.z);
    if (r > 280) { plane.p.x *= 280 / r; plane.p.z *= 280 / r; }
    plane.p.y = clamp(plane.p.y, Math.max(groundAt(plane.p.x, plane.p.z), SEA_Y) + 26, 150);
    plane.pitch = plane.roll = 0; plane.speed = 26; plane.throttle = 0.45; plane.bump = 0;
    chase.yaw = chase.pitch = 0; chase.idle = 9;
    placePlane();
    flyCam(1, true);
  }
  function ensureVehicle(which) {
    if (which === 'drive') { carObj ||= buildCar(); if (!carObj.root.parent) scene.add(carObj.root); }
    if (which === 'fly') { planeObj ||= buildPlane(); if (!planeObj.root.parent) scene.add(planeObj.root, planeObj.blob); }
  }
  function removeVehicle(which) {
    if (which === 'drive' && carObj) scene.remove(carObj.root);
    if (which === 'fly' && planeObj) scene.remove(planeObj.root, planeObj.blob);
  }

  // ---- mode switching --------------------------------------------------------------
  function beginBlend(dur) {
    blend = { t: 0, dur, pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
  }
  function setMode(next) {
    if (!MODES.includes(next) || next === mode) return;
    const prev = mode;
    clearInput();
    closeMenu();
    if (prev === 'orbit' && !exiting) {
      saved = { pos: camera.position.clone(), target: controls ? controls.target.clone() : new THREE.Vector3(), fov: camera.fov, autoRotate: !!controls?.autoRotate };
    }
    if (next === 'orbit') {
      exiting = true;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      beginBlend(1.1);
    } else {
      if (controls) { controls.enabled = false; controls.autoRotate = false; }
      exiting = false;
      if (sim && sim !== next) removeVehicle(sim);
      document.getElementById('tooltip')?.classList.remove('show'); // no stale hover card over the view
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.(); // Space must not re-click a button
      sim = next;
      ensureVehicle(next);
      if (next === 'walk') spawnWalk(); else if (next === 'drive') spawnDrive(); else spawnFly();
      beginBlend(prev === 'orbit' ? 1.3 : 0.8);
    }
    mode = next;
    syncUI();
    try { onModeChange?.(mode); } catch (err) { console.error(err); }
  }
  function finishExit() {
    removeVehicle(sim);
    sim = null; exiting = false; blend = null;
    if (saved) {
      camera.position.copy(saved.pos);
      if (camera.fov !== saved.fov) { camera.fov = saved.fov; camera.updateProjectionMatrix(); }
      if (controls) { controls.target.copy(saved.target); controls.autoRotate = saved.autoRotate; }
    }
    if (controls) { controls.enabled = true; controls.update(); }
  }

  // ---- per-mode simulation ---------------------------------------------------------
  function simWalk(dt, input) {
    const w = walker;
    w.yaw -= input.turn * 1.9 * dt;
    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw), rx = Math.cos(w.yaw), rz = -Math.sin(w.yaw);
    let tx = fx * input.fwd + rx * input.side, tz = fz * input.fwd + rz * input.side;
    const l = Math.hypot(tx, tz);
    if (l > 1) { tx /= l; tz /= l; }
    const kk = damp(dt, w.grounded ? 12 : 2.5);
    w.v.x += (tx * speed - w.v.x) * kk; w.v.z += (tz * speed - w.v.z) * kk;
    const steps = Math.max(1, Math.ceil(Math.hypot(w.v.x, w.v.z) * dt / 0.4));
    for (let i = 0; i < steps; i++) {
      const dx = w.v.x * dt / steps, dz = w.v.z * dt / steps;
      if (onLand(w.p.x + dx, w.p.z)) w.p.x += dx; else w.v.x = 0;
      if (onLand(w.p.x, w.p.z + dz)) w.p.z += dz; else w.v.z = 0;
      if (collide(w.p, PLAYER_R, w.p.y + 0.2, w.p.y + 1.8)) {
        const vn = w.v.x * hitN.x + w.v.z * hitN.z; // slide along the wall
        if (vn < 0) { w.v.x -= vn * hitN.x; w.v.z -= vn * hitN.z; }
      }
    }
    const g = groundAt(w.p.x, w.p.z);
    if (w.grounded && input.jump) { w.vy = JUMP_V; w.grounded = false; }
    if (w.grounded) { if (w.p.y - g > 0.6) w.grounded = false; else w.p.y = g; }
    if (!w.grounded) {
      w.vy -= GRAVITY * dt; w.p.y += w.vy * dt;
      if (w.p.y <= g) { w.p.y = g; w.vy = 0; w.grounded = true; }
    }
    const sp = Math.hypot(w.v.x, w.v.z);
    w.bob += sp * dt;
    const bob = w.grounded && !reducedMotion ? Math.sin(w.bob * 2.4) * 0.05 * Math.min(1, sp / WALK_SPEED) : 0;
    w.fov += ((sp > WALK_SPEED + 1 ? 75 : 70) - w.fov) * damp(dt, 4);
    want.pos.set(w.p.x, w.p.y + EYE + bob, w.p.z);
    want.quat.setFromEuler(_e.set(w.pitch, w.yaw, 0, 'YXZ'));
    want.fov = w.fov;
    want.look.set(0, 0, -12).applyQuaternion(want.quat).add(want.pos);
  }

  function unstickCar() {
    for (let i = 0; i < 3; i++) {
      const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
      for (const off of [CAR.AXLE, -CAR.AXLE]) {
        _c.set(car.p.x + fx * off, 0, car.p.z + fz * off);
        const bx = _c.x, bz = _c.z;
        if (collide(_c, CAR.R, car.y + 0.1, car.y + 1.6)) { car.p.x += _c.x - bx; car.p.z += _c.z - bz; }
      }
    }
  }
  function tiltCar(k) {
    const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw), rx = -fz, rz = fx, hx = CAR.WB / 2, hz = CAR.TRACK / 2, p = car.p;
    const fl = groundAt(p.x + fx * hx - rx * hz, p.z + fz * hx - rz * hz), fr = groundAt(p.x + fx * hx + rx * hz, p.z + fz * hx + rz * hz);
    const rl = groundAt(p.x - fx * hx - rx * hz, p.z - fz * hx - rz * hz), rr = groundAt(p.x - fx * hx + rx * hz, p.z - fz * hx + rz * hz);
    const front = (fl + fr) / 2, rear = (rl + rr) / 2, left = (fl + rl) / 2, right = (fr + rr) / 2;
    const ty = Math.max((front + rear) / 2, groundAt(p.x, p.z));
    car.pitch += (Math.atan2(front - rear, CAR.WB) - car.pitch) * k;
    car.roll += (Math.atan2(left - right, CAR.TRACK) - car.roll) * k;
    car.y = ty >= car.y || k >= 1 ? ty : car.y + (ty - car.y) * Math.min(1, k * 1.2);
  }
  function placeCar() {
    const o = carObj;
    o.root.position.set(car.p.x, car.y, car.p.z);
    o.root.rotation.set(car.roll, car.yaw, car.pitch, 'YZX');
    const b = car.bump;
    o.body.rotation.set(car.lean, 0, car.squat);
    o.body.scale.set(1 + 0.08 * b, 1 - 0.12 * b, 1 + 0.08 * b);
    for (const w of o.wheels) { w.spin.rotation.z = -car.spin; if (w.front) w.steer.rotation.y = -car.steer * 0.42; }
  }
  function simDrive(dt, input) {
    const c = car;
    // 1. Steering turns the heading; the velocity vector lags behind (slip).
    c.steer += (clamp(input.steer, -1, 1) - c.steer) * damp(dt, 7);
    const vfOld = c.v.x * Math.cos(c.yaw) + c.v.y * -Math.sin(c.yaw);
    const yawRate = -c.steer * 2.2 * clamp(vfOld / 4, -1, 1) * (1 - 0.4 * clamp(Math.abs(vfOld) / CAR.MAXF, 0, 1)) * (input.hand ? 1.45 : 1);
    c.yaw = wrapAngle(c.yaw + yawRate * dt);
    // 2. Decompose the world velocity in the new heading.
    const fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw), rx = -fz, rz = fx;
    let vf = c.v.x * fx + c.v.y * fz, vl = c.v.x * rx + c.v.y * rz;
    const thr = clamp(input.thr, -1, 1);
    if (thr > 0.05) vf += (vf < -0.5 ? CAR.BRAKE : CAR.ACC * (1 - clamp(vf / CAR.MAXF, 0, 1) ** 2)) * thr * dt;
    else if (thr < -0.05) vf += (vf > 0.5 ? CAR.BRAKE : CAR.ACC * 0.6 * (1 - clamp(-vf / CAR.MAXR, 0, 1))) * thr * dt;
    else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 3.5 * dt);
    if (input.hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 6 * dt);
    vf -= vf * 0.12 * dt + 9.8 * 0.6 * Math.sin(c.pitch) * dt; // air drag, hills
    const grip = input.hand ? 1.5 : 9 - 4.5 * clamp(Math.abs(vf) / CAR.MAXF, 0, 1);
    vl *= Math.exp(-grip * dt);
    c.v.set(fx * vf + rx * vl, fz * vf + rz * vl);
    // 3. Move in small steps: stay on land, push out of buildings.
    let hx = 0, hz = 0, hit = false;
    const steps = Math.max(1, Math.ceil(c.v.length() * dt / 0.35));
    for (let i = 0; i < steps; i++) {
      const ox = c.p.x, oz = c.p.z;
      c.p.x += c.v.x * dt / steps; c.p.z += c.v.y * dt / steps;
      if (!onLand(c.p.x + fx * 1.2, c.p.z + fz * 1.2 * Math.sign(vf || 1)) || !onLand(c.p.x, c.p.z)) {
        c.p.x = ox; c.p.z = oz;
        landNormal(ox, oz, _v); hx += _v.x; hz += _v.z; hit = true;
        break;
      }
      for (const off of [CAR.AXLE, -CAR.AXLE]) {
        _c.set(c.p.x + fx * off, 0, c.p.z + fz * off);
        const bx = _c.x, bz = _c.z;
        if (collide(_c, CAR.R, c.y + 0.1, c.y + 1.6)) { c.p.x += _c.x - bx; c.p.z += _c.z - bz; hx += hitN.x; hz += hitN.z; hit = true; }
      }
    }
    if (hit) {
      const l = Math.hypot(hx, hz) || 1, nx = hx / l, nz = hz / l, vn = c.v.x * nx + c.v.y * nz;
      if (vn < 0) {
        c.v.x -= 1.35 * vn * nx; c.v.y -= 1.35 * vn * nz; c.v.multiplyScalar(0.8);
        if (-vn > 3) {
          c.bump = Math.max(c.bump, Math.min(1, -vn / 12)); chase.shake = Math.max(chase.shake, c.bump);
          for (let i = 0; i < 5; i++) puff(c.p.x + fx * 1.4 * Math.sign(vf || 1), c.y + 0.6, c.p.z + fz * 1.4 * Math.sign(vf || 1),
            (Math.random() - 0.5) * 3 + nx * 2, 1 + Math.random(), (Math.random() - 0.5) * 3 + nz * 2, 0.7, 0xf6efe1, 0.8);
        }
      }
    }
    // 4. Sit on the terrain: sample the four wheels, tilt to the slope.
    tiltCar(damp(dt, 12));
    const accel = (vf - c.lastVf) / Math.max(dt, 1e-3); c.lastVf = vf;
    c.squat += (clamp(accel * 0.004, -0.06, 0.06) - c.squat) * damp(dt, 6);
    c.lean += (clamp(yawRate * vf * 0.006, -0.1, 0.1) - c.lean) * damp(dt, 6);
    c.spin += vf * dt / CAR.WR;
    c.bump = Math.max(0, c.bump - dt * 3);
    c.vf = vf; c.vl = vl;
    placeCar();
    // Tyre smoke when sliding or drifting.
    c.puffT -= dt;
    if ((Math.abs(vl) > 2.4 || (input.hand && Math.abs(vf) > 5)) && c.puffT <= 0) {
      c.puffT = 0.05;
      for (const s of [-1, 1]) puff(c.p.x - fx * 0.95 + rx * s * 0.75, c.y + 0.25, c.p.z - fz * 0.95 + rz * s * 0.75,
        -c.v.x * 0.15, 0.4, -c.v.y * 0.15, 0.55, 0xe9e4d8, 0.9);
    }
    const night = 1 - clamp(dayFactor(), 0, 1);
    carObj.lamp.emissiveIntensity = 0.3 + night * 1.8;
    carObj.tail.emissiveIntensity = 0.3 + night * 0.9 + (thr < -0.05 && vf > 0.5 ? 1.2 : 0);
    carObj.beamMat.opacity = night * 0.6;
    carObj.beamMat.visible = night > 0.02;
    driveCam(dt, false);
  }
  function driveCam(dt, snap) {
    const c = car, zoom = chase.zoom.drive, fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw);
    chase.idle += dt;
    if (chase.idle > 1.5 && !drag) { chase.yaw *= Math.exp(-dt * 2); chase.pitch *= Math.exp(-dt * 2); }
    const ang = c.yaw + Math.PI + chase.yaw, back = 7.4 * zoom, up = 2.8 * zoom + chase.pitch * 6;
    _v.set(c.p.x + Math.cos(ang) * back, c.y + up, c.p.z - Math.sin(ang) * back);
    _v2.set(c.p.x + fx * 2.2, c.y + 1.1, c.p.z + fz * 2.2);
    if (snap) { chase.pos.copy(_v); chase.look.copy(_v2); }
    else { chase.pos.lerp(_v, damp(dt, 5)); chase.look.lerp(_v2, damp(dt, 10)); }
    chase.pos.y = Math.max(chase.pos.y, groundAt(chase.pos.x, chase.pos.z) + 0.9);
    finishChase(dt, _c.set(c.p.x, c.y + 1.3, c.p.z), 55 + clamp(Math.abs(c.vf) / CAR.MAXF, 0, 1) * 12, 0);
  }
  // Pull the chase cam in front of any wall between it and the vehicle, then aim.
  function finishChase(dt, anchor, fov, bank) {
    want.pos.copy(chase.pos);
    const full = anchor.distanceTo(want.pos), d = segmentHit(anchor, want.pos);
    if (d < full) want.pos.lerpVectors(anchor, want.pos, Math.max(0.15, (d - 0.6) / full));
    if (chase.shake > 0 && !reducedMotion) {
      want.pos.x += (Math.random() - 0.5) * chase.shake * 0.35; want.pos.y += (Math.random() - 0.5) * chase.shake * 0.35;
      chase.shake = Math.max(0, chase.shake - dt * 2.5);
    }
    _m.lookAt(want.pos, chase.look, UP);
    want.quat.setFromRotationMatrix(_m);
    if (bank) want.quat.multiply(_q.setFromAxisAngle(ZAXIS, bank));
    want.fov = fov;
    want.look.copy(chase.look);
  }

  function placePlane() {
    const o = planeObj, p = plane;
    o.root.position.copy(p.p);
    o.root.rotation.set(p.roll, p.yaw, p.pitch, 'YZX');
    const b = p.bump;
    o.root.scale.set(1 - 0.06 * b, 1 + 0.08 * b, 1);
    const g = Math.max(groundAt(p.p.x, p.p.z), SEA_Y), alt = p.p.y - g;
    o.blob.position.set(p.p.x, g + 0.08, p.p.z);
    o.blob.rotation.y = p.yaw;
    o.blob.material.opacity = 0.5 * (1 - clamp(alt / 45, 0, 1));
    o.blob.visible = alt < 45;
  }
  function simFly(dt, input, elapsed) {
    const p = plane;
    p.throttle = clamp(p.throttle + (input.faster - input.slower) * 0.6 * dt, 0, 1);
    const target = PLANE.MIN + 3 + p.throttle * (PLANE.MAX - PLANE.MIN - 8);
    p.speed += (target - p.speed) * damp(dt, 0.8) - Math.sin(p.pitch) * 7 * dt; // dives speed up, climbs bleed speed
    p.speed = clamp(p.speed, PLANE.MIN, PLANE.MAX);
    // Bank to turn; release the stick and she levels herself out.
    let rollTarget = clamp(input.roll, -1, 1) * 1.0;
    // Soft world bound: past SOFT_R the plane banks itself back toward the island.
    const r = Math.hypot(p.p.x, p.p.z);
    let homeTurn = 0;
    if (r > PLANE.SOFT_R) {
      const toC = Math.atan2(p.p.z / r, -p.p.x / r), diff = wrapAngle(toC - p.yaw), kk = clamp((r - PLANE.SOFT_R) / 60, 0, 1);
      homeTurn = clamp(diff, -1, 1) * 1.4 * kk;
      if (!input.roll) rollTarget = -Math.sign(diff) * 0.7 * kk;
    }
    p.roll += (rollTarget - p.roll) * damp(dt, input.roll ? 3 : 2);
    if (input.pitch) p.pitch += clamp(input.pitch, -1, 1) * 1.1 * dt;
    else p.pitch += (0 - p.pitch) * damp(dt, 1.1);
    if (p.p.y > PLANE.CEIL) p.pitch += (-0.25 - p.pitch) * damp(dt, 2);
    p.pitch = clamp(p.pitch, -1.0, 1.0);
    p.yaw = wrapAngle(p.yaw + (-Math.sin(p.roll) * 1.25 - clamp(input.roll, -1, 1) * 0.12) * dt + homeTurn * dt);
    const cp = Math.cos(p.pitch), fx = cp * Math.cos(p.yaw), fy = Math.sin(p.pitch), fz = -cp * Math.sin(p.yaw);
    p.p.x += fx * p.speed * dt; p.p.y += fy * p.speed * dt; p.p.z += fz * p.speed * dt;
    const r2 = Math.hypot(p.p.x, p.p.z);
    if (r2 > PLANE.HARD_R) { p.p.x *= PLANE.HARD_R / r2; p.p.z *= PLANE.HARD_R / r2; }
    // Buildings: skim over roofs, glance off walls.
    for (const b of getBoxes()) {
      if (p.p.y > b.max.y + 1.6 || p.p.x < b.min.x - 1.5 || p.p.x > b.max.x + 1.5 || p.p.z < b.min.z - 1.5 || p.p.z > b.max.z + 1.5) continue;
      if (p.p.y > b.max.y - 3) { p.p.y = b.max.y + 1.6; p.pitch = Math.max(p.pitch, 0.18); }
      else if (collide(p.p, 1.5, p.p.y - 1, p.p.y + 1, false)) {
        const hfx = Math.cos(p.yaw), hfz = -Math.sin(p.yaw), dn = hfx * hitN.x + hfz * hitN.z;
        if (dn < 0) { const nx = hfx - 2 * dn * hitN.x, nz = hfz - 2 * dn * hitN.z; p.yaw = Math.atan2(-nz, nx); }
        p.speed *= 0.75; p.bump = 1; chase.shake = 0.8;
      }
    }
    // Minimum altitude: low over the paved city and the sea, but above the
    // treetops on the island (trees aren't colliders), with a smooth ramp.
    const gy = groundAt(p.p.x, p.p.z), wooded = gy > SEA_LIMIT ? THREE.MathUtils.smoothstep(sdSlab(p.p.x, p.p.z), 2, 14) : 0;
    const floor = Math.max(gy, SEA_Y) + PLANE.FLOOR + wooded * 7;
    if (p.p.y < floor) {
      if (p.pitch < -0.15) { p.bump = Math.max(p.bump, 0.7); chase.shake = Math.max(chase.shake, 0.5); }
      p.p.y = floor; p.pitch = Math.max(p.pitch, 0.3);
    }
    p.bump = Math.max(0, p.bump - dt * 2.5);
    p.prop += (18 + p.throttle * 40) * dt;
    planeObj.prop.rotation.x = p.prop;
    planeObj.discMat.opacity = 0.1 + p.throttle * 0.12;
    planeObj.scarf.rotation.y = Math.sin(elapsed * 18) * 0.25;
    planeObj.scarf.rotation.z = 0.15 + Math.sin(elapsed * 11) * 0.1;
    const night = 1 - clamp(dayFactor(), 0, 1);
    planeObj.navL.emissiveIntensity = planeObj.navR.emissiveIntensity = 0.5 + night * 2.2;
    placePlane();
    // Contrail puffs from the tail.
    p.puffT -= dt;
    if (p.puffT <= 0) {
      p.puffT = 0.06;
      puff(p.p.x - fx * 3, p.p.y - fy * 3 + 0.1, p.p.z - fz * 3, -fx * 2, 0.2, -fz * 2, 0.4 + p.throttle * 0.3, 0xffffff, 1.2);
    }
    flyCam(dt, false);
  }
  function flyCam(dt, snap) {
    const p = plane, zoom = chase.zoom.fly;
    chase.idle += dt;
    if (chase.idle > 1.5 && !drag) { chase.yaw *= Math.exp(-dt * 2); chase.pitch *= Math.exp(-dt * 2); }
    const yaw = p.yaw + chase.yaw, pp = p.pitch * 0.6, cp = Math.cos(pp);
    const back = 13 * zoom, up = 3.8 * zoom + chase.pitch * 8;
    _v.set(p.p.x - cp * Math.cos(yaw) * back, p.p.y - Math.sin(pp) * back + up, p.p.z + cp * Math.sin(yaw) * back);
    const cpf = Math.cos(p.pitch);
    _v2.set(p.p.x + cpf * Math.cos(p.yaw) * 7, p.p.y + Math.sin(p.pitch) * 7 + 0.9, p.p.z - cpf * Math.sin(p.yaw) * 7);
    if (snap) { chase.pos.copy(_v); chase.look.copy(_v2); }
    else { chase.pos.lerp(_v, damp(dt, 4.5)); chase.look.lerp(_v2, damp(dt, 8)); }
    chase.pos.y = Math.max(chase.pos.y, Math.max(groundAt(chase.pos.x, chase.pos.z), SEA_Y) + 1.8);
    finishChase(dt, _c.copy(p.p), 58 + clamp((p.speed - PLANE.MIN) / (PLANE.MAX - PLANE.MIN), 0, 1) * 12, -p.roll * 0.35);
  }

  function readInput() {
    const up = k('KeyW', 'ArrowUp'), down = k('KeyS', 'ArrowDown');
    const a = k('KeyA'), d = k('KeyD'), la = k('ArrowLeft'), ra = k('ArrowRight');
    return {
      fwd: clamp(up - down - joy.y, -1, 1), side: clamp(d - a + joy.x, -1, 1), turn: ra - la,
      run: !!(k('ShiftLeft', 'ShiftRight') || acts.has('run')), jump: !!(k('Space') || acts.has('jump')),
      thr: clamp(up - down - joy.y, -1, 1), steer: clamp(d + ra - a - la + joy.x, -1, 1), hand: !!(k('Space') || acts.has('brake')),
      pitch: clamp(down - up + joy.y, -1, 1), roll: clamp(d + ra - a - la + joy.x, -1, 1),
      faster: k('ShiftLeft', 'ShiftRight', 'KeyE') || (acts.has('faster') ? 1 : 0),
      slower: k('ControlLeft', 'ControlRight', 'KeyQ') || (acts.has('slower') ? 1 : 0),
    };
  }
  const NEUTRAL = { fwd: 0, side: 0, turn: 0, run: false, jump: false, thr: 0, steer: 0, hand: false, pitch: 0, roll: 0, faster: 0, slower: 0 };

  let hudT = 0;
  function updateGauge(dt) {
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.12;
    let txt = '';
    if (mode === 'drive') txt = `<b>${Math.round(Math.abs(car.vf) * TO_M * 3.6)}</b> km/h`;
    else if (mode === 'fly') {
      const alt = plane.p.y - Math.max(groundAt(plane.p.x, plane.p.z), SEA_Y);
      txt = `<b>${Math.round(plane.speed * TO_M * 3.6)}</b> km/h · <b>${Math.round(alt * TO_M)}</b> m · thr <b>${Math.round(plane.throttle * 100)}</b>%`;
    }
    if (gaugeEl.innerHTML !== txt) gaugeEl.innerHTML = txt;
    gaugeEl.hidden = !txt;
  }

  // ---- public ---------------------------------------------------------------------------
  function update(dt, elapsed = 0) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    updatePuffs(dt);
    if (mode === 'orbit' && !exiting) return false;
    if (needUnstick && sim) {
      needUnstick = false;
      if (sim === 'walk') {
        if (!onLand(walker.p.x, walker.p.z)) spawnWalk();
        collide(walker.p, PLAYER_R, walker.p.y + 0.2, walker.p.y + 1.8);
      } else if (sim === 'drive') {
        if (!onLand(car.p.x, car.p.z)) spawnDrive(); else unstickCar();
      }
    }
    const input = exiting ? NEUTRAL : readInput();
    if (sim === 'walk') simWalk(dt, input);
    else if (sim === 'drive') simDrive(dt, input);
    else if (sim === 'fly') simFly(dt, input, elapsed);
    if (exiting && saved) {
      want.pos.copy(saved.pos);
      _m.lookAt(saved.pos, saved.target, UP);
      want.quat.setFromRotationMatrix(_m);
      want.fov = saved.fov;
      want.look.copy(saved.target);
    }
    // Blend from wherever the camera was into the mode's camera.
    let fov = want.fov;
    if (blend) {
      blend.t += dt;
      const t = easeInOut(Math.min(1, blend.t / blend.dur));
      camera.position.lerpVectors(blend.pos, want.pos, t);
      camera.quaternion.slerpQuaternions(blend.quat, want.quat, t);
      fov = blend.fov + (want.fov - blend.fov) * t;
      if (t >= 1) blend = null;
    } else {
      camera.position.copy(want.pos);
      camera.quaternion.copy(want.quat);
    }
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (exiting && !blend) { finishExit(); return false; }
    // Keep the orbit target on what we look at, so the host's cloud fading
    // (camera -> target line of sight) keeps working.
    if (controls && !exiting) controls.target.copy(want.look);
    if (!exiting) updateGauge(dt);
    return true;
  }
  function resetColliders() { boxes = null; needUnstick = !!sim; }
  function dispose() {
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    removeEventListener('pointerdown', onPointerDown, cap);
    removeEventListener('pointermove', onPointerMove, cap);
    removeEventListener('pointerup', onPointerUp, cap);
    document.removeEventListener('pointerdown', onDocDown, cap);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onLockChange);
    canvas.removeEventListener('wheel', onWheel);
    button?.removeEventListener('click', onButton);
    if (mode !== 'orbit' || exiting) { mode = 'orbit'; exiting = true; blend = null; finishExit(); }
    for (const n of [hud, menu, cross, touch]) n.remove();
    document.body.classList.remove('gcx-on');
    const free = (o) => o?.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
    if (carObj) { scene.remove(carObj.root); free(carObj.root); }
    if (planeObj) { scene.remove(planeObj.root, planeObj.blob); free(planeObj.root); free(planeObj.blob); }
    if (puffs) { scene.remove(puffs.mesh, puffs.inkMesh); puffs.geo.dispose(); puffs.mesh.dispose(); puffs.inkMesh.dispose(); }
    for (const m of ownedMats) m.dispose();
    blobTex?.dispose(); ramp?.dispose();
    carObj = planeObj = puffs = null;
  }

  return {
    setMode,
    get mode() { return mode; },
    /** True while a mode (or the glide back to orbit) is driving the camera. */
    get ownsCamera() { return mode !== 'orbit' || exiting; },
    /** Host key handlers should ignore events the explorer claims (all but Esc / V while exploring). */
    wantsKey(e) { return mode !== 'orbit' && e.key !== 'Escape' && e.key !== 'v' && e.key !== 'V'; },
    update, dispose, resetColliders,
    groundAt,
    /** Debug / test hooks: collider count, box list, and teleporting the active walker / car. */
    debug: {
      boxes: () => getBoxes().map((b) => ({ min: b.min.toArray(), max: b.max.toArray() })),
      place(x, z, yaw = 0) {
        if (sim === 'walk') { walker.p.set(x, groundAt(x, z), z); walker.yaw = yaw; walker.v.set(0, 0, 0); }
        else if (sim === 'drive') { car.p.set(x, 0, z); car.yaw = yaw; car.v.set(0, 0); car.y = groundAt(x, z); }
      },
    },
    get state() { return { mode, sim, car: { x: car.p.x, y: car.y, z: car.p.z, speed: car.vf, pitch: car.pitch, roll: car.roll }, plane: { ...plane.p, speed: plane.speed, roll: plane.roll, pitch: plane.pitch }, walker: { ...walker.p } }; },
  };
}

// Styles live with the module so index.html only needs the Explore button.
function injectStyle() {
  if (document.getElementById('gcx-style')) return;
  const s = document.createElement('style');
  s.id = 'gcx-style';
  s.textContent = `
  .gcx-hud { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--transport-h, 96px) + 14px); z-index: 30;
    display: flex; align-items: center; gap: 12px; padding: 5px 5px 5px 6px; max-width: calc(100vw - 24px);
    background: var(--panel, rgba(17, 24, 36, 0.8)); border: 1px solid var(--line, rgba(110, 135, 175, 0.22)); border-radius: 999px;
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    font: 11px/1.2 var(--mono, ui-monospace, Menlo, monospace); color: var(--ink-500, #7f8ca3); user-select: none; -webkit-user-select: none; }
  .gcx-hud[hidden], .gcx-menu[hidden], .gcx-touch[hidden], .gcx-cross[hidden], .gcx-gauge[hidden] { display: none !important; }
  .gcx-hud b { color: var(--ink-100, #f1f4f9); font-weight: 600; }
  .gcx-seg { display: flex; gap: 2px; padding: 2px; border-radius: 999px; background: rgba(255, 255, 255, 0.05); flex: none; }
  .gcx-seg button, .gcx-exit { font: inherit; border: 0; cursor: pointer; border-radius: 999px; padding: 6px 11px; background: none; color: var(--ink-300, #c2cad8); }
  .gcx-seg button:hover, .gcx-exit:hover { color: var(--ink-100, #f1f4f9); background: rgba(255, 255, 255, 0.06); }
  .gcx-seg button.on { background: var(--accent, #64dedb); color: var(--accent-ink, #082524); font-weight: 600; }
  .gcx-hint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .gcx-gauge { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--ink-300, #c2cad8); flex: none; }
  .gcx-exit { flex: none; background: rgba(255, 255, 255, 0.06); }
  .gcx-hud kbd, .gcx-menu kbd { font: 600 9px/1 var(--mono, monospace); padding: 2px 4px; border-radius: 4px; border: 1px solid var(--line, rgba(110, 135, 175, 0.3)); color: var(--ink-500, #7f8ca3); margin-right: 4px; }
  .gcx-menu { position: fixed; z-index: 60; display: flex; flex-direction: column; gap: 2px; padding: 5px; min-width: 150px;
    background: rgba(17, 24, 36, 0.97); border: 1px solid var(--line, rgba(110, 135, 175, 0.22)); border-radius: 10px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); }
  .gcx-menu button { display: flex; align-items: center; justify-content: space-between; gap: 18px; border: 0; background: none; cursor: pointer;
    font: 12px var(--mono, monospace); color: var(--ink-300, #c2cad8); padding: 9px 10px; border-radius: 7px; text-align: left; }
  .gcx-menu button:hover { background: rgba(255, 255, 255, 0.06); color: var(--ink-100, #f1f4f9); }
  .gcx-menu button.on { color: var(--accent, #64dedb); }
  .gcx-menu kbd { margin: 0; }
  .gcx-cross { position: fixed; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; z-index: 25; pointer-events: none;
    background: rgba(255, 255, 255, 0.9); box-shadow: 0 0 0 1.5px rgba(10, 13, 22, 0.85); }
  .gcx-stick { position: fixed; z-index: 31; left: max(18px, env(safe-area-inset-left)); bottom: calc(var(--transport-h, 96px) + 70px);
    width: 124px; height: 124px; border-radius: 50%; touch-action: none; background: rgba(17, 24, 36, 0.45);
    border: 1.5px solid rgba(241, 244, 249, 0.25); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .gcx-knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
    background: rgba(100, 222, 219, 0.85); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4); pointer-events: none; }
  .gcx-acts { position: fixed; z-index: 31; right: max(18px, env(safe-area-inset-right)); bottom: calc(var(--transport-h, 96px) + 76px);
    display: flex; flex-direction: column; gap: 12px; }
  .gcx-act { width: 66px; height: 66px; border-radius: 50%; touch-action: none; font: 600 13px var(--mono, monospace); color: var(--ink-100, #f1f4f9);
    background: rgba(17, 24, 36, 0.55); border: 1.5px solid rgba(241, 244, 249, 0.3); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .gcx-act.on { background: rgba(100, 222, 219, 0.85); color: var(--accent-ink, #082524); }
  .gcx-hud.gcx-touchy .gcx-hint { display: none; }
  @media (max-width: 900px), (max-height: 500px) {
    .gcx-hint { display: none; }
    .gcx-hud { bottom: auto; top: calc(var(--topbar-h, 58px) + 10px); gap: 6px; }
    .gcx-seg button, .gcx-exit { padding: 6px 9px; }
    .gcx-exit kbd { display: none; }
    /* Touch controls need the corners: tuck the host's floating cards away while exploring. */
    body.gcx-on #explorer, body.gcx-on #clock, body.gcx-on #feed, body.gcx-on #legend { visibility: hidden; }
  }`;
  document.head.append(s);
}
