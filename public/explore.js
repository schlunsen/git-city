// ---------------------------------------------------------------------------
// explore.js — walk, drive and fly through Gitilla.
//
// createExplorer(THREE, deps) layers three camera modes over the app's
// OrbitControls view:
//   walk  — first person: WASD / arrows, mouse look (pointer lock, or drag when
//           the lock is unavailable), Shift to run, hold Space to fly. Collides with
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

import { LANE_OFFSET } from './city/layout.js'; // the boulevard's car lanes (drive mode spawns on the outer one)
import { bumpTrafficCars } from './city/cars.js'; // drive mode barges the traffic aside
import { createRepoInspector } from './repo-inspector.js';
import { createBombRun } from './game.js'; // the bomb-run mini game (fly mode)
import { injectStyle, WARP_FRAG, injectTravelStyle } from './explore-style.js'; // CSS + travel-warp shader
import { cityArrivalLevels } from './city/city-arrival.js';
import { closeGource } from './city/gource-player.js'; // leaving the island takes the replay with it
import { endTour } from './city/tour.js';              // ...and the tour, and its card
import { buildPerson, posePerson, disposePerson } from './city/townlife.js'; // the figure you walk around as

const MODES = ['orbit', 'walk', 'drive', 'fly'];
const LABEL = { orbit: 'Orbit', walk: 'Walk', drive: 'Drive', fly: 'Fly' };
const EYE = 1.65, PLAYER_R = 0.45, WALK_SPEED = 5.2, RUN_SPEED = 11, UNICORN_CLIMB = 7.4, UNICORN_FALL = 4.5, GRAVITY = 22;
// Third-person framing: how far back the camera sits, what it aims at, and how
// high it rides when the look is level. Close enough that a doorway still has
// scale, far enough that the figure is a person rather than a shoulder.
const TP_DIST = 4.6, TP_FOCUS = 1.15, TP_ELEV = 0.26;
const SEA_LIMIT = -0.9;      // heightAt below this is water: no walking or driving
const SEA_Y = -1.25;         // the sea plane, the plane's floor over water
const BOX_PAD = 0.3;         // grow building boxes past the roof overhang and ink rim
const CAR = { L: 3.0, W: 1.62, WR: 0.42, WB: 1.9, TRACK: 1.4, R: 0.8, AXLE: 0.66, MAXF: 26, MAXR: 8, ACC: 15, BRAKE: 32 };
const PLANE = { MIN: 11, MAX: 54, FLOOR: 2.6, SOFT_R: 330, HARD_R: 430, CEIL: 190 };
const TO_M = 1.6;            // world units -> metres for the HUD (a 3-unit car is ~4.8 m)
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyB', 'KeyG']);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (dt, rate) => 1 - Math.exp(-dt * rate);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const noRaycast = () => {};

export function createExplorer(THREE, deps = {}) {
  let game = null;          // bomb run (game.js), created with the HUD below
  let planeFrozen = false;  // crashed in the bomb run: the plane waits for Play again / Exit
  const gameMouse = { fire: false, bomb: false }, gameInput = { fire: false, bomb: false };
  const { scene, camera, renderer, controls, onModeChange } = deps;
  if (!scene || !camera || !renderer) throw new Error('createExplorer: scene, camera and renderer are required');
  const canvas = renderer.domElement;
  const heightAt = deps.heightAt || (() => 0);
  const colliders = deps.colliders || (() => []);
  const dayFactor = deps.dayFactor || (() => 1);
  // City layout (defaults mirror city/layout.js: paved slab, boulevard ring, plaza).
  // island.streets moves the cell and everything measured from it, and the
  // explorer outlives a city, so these are re-read per city (syncDims, called
  // from resetColliders) rather than captured once at boot.
  const dim = (v, d) => (typeof v === 'function' ? v() : v ?? d);
  let SLAB, RING, CELL, PLAZA;
  function syncDims() {
    SLAB = { half: dim(deps.slabHalf, 56.5), r: dim(deps.slabRadius, 15), y: 0.09 };
    RING = { half: dim(deps.ringHalf, 49.5), corner: dim(deps.ringCorner, 8) };
    CELL = dim(deps.cell, 9);
    PLAZA = { r: dim(deps.plazaRadius, 15.3), y: 0.14 };
  }
  syncDims();
  // Round obstacles: the fountain pool around the monument and the four planters.
  const obstacles = deps.obstacles ?? [{ x: 0, z: 0, r: 7.4 },
    ...[1, 3, 5, 7].map((k) => ({ x: Math.cos(k * Math.PI / 4) * 13.8, z: Math.sin(k * Math.PI / 4) * 13.8, r: 1.2 }))];
  const reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const UP = new THREE.Vector3(0, 1, 0), ZAXIS = new THREE.Vector3(0, 0, 1);
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const _e = new THREE.Euler(), _ray = new THREE.Ray(), _hit = new THREE.Vector3(), _c = new THREE.Vector3();

  // ---- ground ---------------------------------------------------------------
  // Live city footprint (city/block.js cityLayout): dist(x, z) < 0 inside the boulevard
  // centreline, the slab edge SIDEWALK beyond it; contour(offset) / streets give
  // spawn points. Without one we fall back to the classic rounded square.
  const SIDEWALK = SLAB.half - RING.half; // 7 at every street width (layout.js SIDEWALK)
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
  let livery = { color: null, name: '' }; // city.json plane: fuselage colour + painted name (setLivery)
  function buildPlane() {
    const root = new THREE.Group();
    const red = toon(livery.color ?? 0xef5b4c), cream = toon(0xf6efe1), trim = toon(0x2a2f3a), yellow = toon(0xf6c343), wood = toon(0x9a6a4a);
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
    // The developer's name for her, on both sides of the fuselage (canvas fillText only).
    let nameTex = null;
    if (livery.name) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
      const g = cv.getContext('2d');
      const font = (px) => `italic 800 ${px}px "Space Grotesk", ui-sans-serif, system-ui, sans-serif`;
      let px = 64;
      g.font = font(px);
      while (g.measureText(livery.name).width > 480 && px > 18) { px -= 2; g.font = font(px); }
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = Math.max(4, px * 0.18); g.strokeStyle = '#1a2233'; g.strokeText(livery.name, 256, 50);
      g.fillStyle = '#f6efe1'; g.fillText(livery.name, 256, 50);
      nameTex = new THREE.CanvasTexture(cv);
      nameTex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      ownedMats.push(mat);
      for (const side of [-1, 1]) {
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), mat);
        decal.position.set(-0.5, 0.06, side * 0.61);
        if (side < 0) decal.rotation.y = Math.PI; // reads left to right from either side
        decal.raycast = noRaycast;
        root.add(decal);
      }
    }
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(8, 6).rotateX(-Math.PI / 2), blobMaterial());
    blob.raycast = noRaycast;
    return { root, prop, discMat, scarf, blob, navL, navR, nameTex };
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
  const car = { p: new THREE.Vector3(), v: new THREE.Vector2(), yaw: 0, y: 0, pitch: 0, roll: 0, steer: 0, lean: 0, squat: 0, spin: 0, bump: 0, vf: 0, vl: 0, lastVf: 0, puffT: 0, smokeT: 0 };
  const plane = { p: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 26, throttle: 0.45, prop: 0, puffT: 0, bump: 0 };
  const chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, pitch: 0, idle: 9, zoom: { drive: 1, fly: 1 }, shake: 0 };
  // The figure on the pavement. Built the first time somebody walks, then kept:
  // it is nine small meshes and rebuilding it on every mode change would throw
  // its walk cycle away mid-stride.
  let person = null;
  const _cam = new THREE.Vector3(), _foc = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);

  // ---- input ---------------------------------------------------------------------
  const keys = new Set(), acts = new Set();
  const joy = { x: 0, y: 0, id: null };
  let locked = false, unlockedAt = -1e9, drag = null, sawTouch = false;
  const isTyping = (e) => !!e.target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  function onKeyDown(e) {
    if (isTyping(e) || e.metaKey || e.altKey) return;
    if (repoInspector.key(e) || repoInspector.open) return;
    if (!e.ctrlKey && e.code === 'KeyN') { flyToNext(); e.preventDefault(); return; } // next island
    if (!e.ctrlKey && e.code === 'KeyG' && mode !== 'orbit') { startGame(); e.preventDefault(); return; } // bomb run
    if (!e.ctrlKey && /^Digit[1-4]$/.test(e.code)) {
      setMode(MODES[Number(e.code.slice(5)) - 1]);
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      if (!menu.hidden) { closeMenu(); return; }
      if (game?.active) { game.exit(); return; } // Esc ends the bomb run, back to plain flying
      // The first Esc only frees the mouse (the browser does that for us).
      if (mode !== 'orbit' && !locked && performance.now() - unlockedAt > 300) setMode('orbit');
      return;
    }
    if (mode === 'orbit') return;
    keys.add(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  }
  function onKeyUp(e) { keys.delete(e.code); if (mode !== 'orbit' && GAME_KEYS.has(e.code)) e.preventDefault(); }
  function clearInput() { gameMouse.fire = gameMouse.bomb = false; keys.clear(); acts.clear(); joy.x = joy.y = 0; joy.id = null; drag = null; if (stickKnob) stickKnob.style.transform = ''; }
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
    if (game?.active && e.pointerType === 'mouse' && (e.button === 0 || e.button === 2)) { // bomb run: left fires, right bombs
      if (e.button === 0) gameMouse.fire = true; else gameMouse.bomb = true;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      return;
    }
    if (e.pointerType === 'touch' && !sawTouch) { sawTouch = true; syncUI(); }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, type: e.pointerType };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  }
  function onPointerMove(e) {
    if (mode === 'orbit' || e.target !== canvas) return;
    e.stopPropagation();
    if (e.pointerType === 'mouse' && (gameMouse.fire || gameMouse.bomb || game?.active)) { gameMouse.fire = !!(e.buttons & 1) && !!game?.active; gameMouse.bomb = !!(e.buttons & 2) && !!game?.active; }
    if (locked || !drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    look(dx, dy, drag.type === 'touch' ? 0.006 : 0.0045);
  }
  function onPointerUp(e) {
    if (mode === 'orbit' || e.target !== canvas) return;
    e.stopPropagation();
    if (e.pointerType === 'mouse') { gameMouse.fire = !!(e.buttons & 1) && !!game?.active; gameMouse.bomb = !!(e.buttons & 2) && !!game?.active; }
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
  function onBlur() { clearInput(); }
  // Scope accidental page pinches to touch flight; desktop wheel framing stays.
  const touchFlight = () => mode === 'fly' && (sawTouch || !!coarse?.matches);
  function onGesture(e) { if (touchFlight()) e.preventDefault(); }
  function onTouchMove(e) { if (touchFlight() && e.touches?.length > 1) e.preventDefault(); }
  function onWheel(e) {
    if ((mode !== 'drive' && mode !== 'fly') || touchFlight()) return;
    chase.zoom[mode] = clamp(chase.zoom[mode] * (1 + Math.sign(e.deltaY) * 0.08), 0.6, 2.4);
  }

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
  const repoInspector = createRepoInspector(THREE, {
    camera, buildings: () => deps.buildings?.() || [],
    onOpen: () => {
      clearInput(); walker.v.set(0, 0, 0); car.v.set(0, 0);
      car.vf = car.vl = car.lastVf = 0;
    },
    onClose: clearInput,
    onRepo: (repo) => deps.onRepo?.(repo), // walk / drive / tour / a building click all land here
  });
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
  const ACTS = { walk: [['jump', 'Fly ↑'], ['run', 'Run']], drive: [['brake', 'Drift']], fly: [['faster', '+'], ['slower', '−']] };
  const GAME_ACTS = [['fire', 'FIRE'], ['bomb', 'BOMB']]; // bomb run on touch: hold FIRE, tap BOMB
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
    walk: () => (locked ? '<b>WASD</b> move · <b>Shift</b> run · hold <b>Space</b> fly · <b>E</b> inspect repo · <b>Esc</b> free mouse'
      : '<b>WASD</b> move · <b>←→</b> turn · <b>Shift</b> run · hold <b>Space</b> fly · <b>click</b> to mouse-look · <b>E</b> inspect repo'),
    drive: () => '<b>W/S</b> gas · brake · <b>A/D</b> steer · <b>Space</b> drift · drag to look · <b>E</b> inspect repo',
    fly: () => '<b>S</b> climb · <b>W</b> dive · <b>A/D</b> bank · <b>E/Q</b> throttle · <b>N</b> next island',
    game: () => '<b>Space</b>/<b>click</b> fire · <b>B</b>/<b>right-click</b> bomb · <b>A/D</b> bank · <b>W/S</b> dive · climb · <b>Esc</b> end',
  };
  function syncUI() {
    const on = mode !== 'orbit';
    hud.hidden = !on;
    document.body.classList.toggle('gcx-on', on);
    for (const b of hud.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    for (const b of menu.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    const gaming = !!game?.active;
    hud.classList.toggle('gcx-gaming', gaming);
    if (on) hintEl.innerHTML = gaming ? HINTS.game() : HINTS[mode]();
    cross.hidden = !(mode === 'walk' && locked);
    const touchUI = on && (sawTouch || !!coarse?.matches);
    touch.hidden = !touchUI;
    hud.classList.toggle('gcx-touchy', touchUI);
    const actsKey = gaming ? 'game' : mode;
    if (touchUI && actsEl.dataset.mode !== actsKey) {
      actsEl.dataset.mode = actsKey;
      actsEl.innerHTML = ((gaming ? GAME_ACTS : ACTS[mode]) || []).map(([a, t]) => `<button type="button" class="gcx-act" data-act="${a}">${t}</button>`).join('');
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
  canvas.addEventListener('wheel', onWheel, { passive: true });
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, onGesture, { passive: false });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  addEventListener('pointerdown', onPointerDown, cap);
  addEventListener('pointermove', onPointerMove, cap);
  addEventListener('pointerup', onPointerUp, cap);
  document.addEventListener('pointerdown', onDocDown, cap);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);

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
  // ... and the point of the boulevard's outer lane (the host's boulevardLane(L, LANE_OFFSET)
  // resamples this same contour) on the camera's bearing, with its tangent.
  function layoutBoulevard(cx, cz) {
    const L = getLayout();
    let pts = null;
    try { pts = typeof L?.contour === 'function' ? L.contour(LANE_OFFSET) : null; } catch { pts = null; }
    if (!pts || pts.length < 8) return null;
    const N = pts.length, a = ((Math.atan2(cz, cx) / (Math.PI * 2)) % 1 + 1) % 1, k = Math.floor(a * N) % N;
    const p = pts[k], q = pts[(k + 2) % N], tl = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    return { x: p.x, z: p.z, tx: (q.x - p.x) / tl, tz: (q.z - p.z) / tl };
  }
  // Steer the car along the boulevard's outer lane, the one it spawns on and the
  // one the ambient traffic uses. layoutBoulevard indexes the contour by bearing,
  // so "further along" is simply a larger angle about the centre.
  let autopilot = null;
  const _cityEye = new THREE.Vector3();
  // Driving stops at each repository the way a visitor would: pull up, press E,
  // read, move on. The guide freezes the simulation for us while it is open
  // (see update), so "parked" needs no braking logic of its own.
  const autoCar = { seen: new Set(), stuck: 0, cruise: 0 };
  // The next repository worth pulling over for: nearest unvisited building
  // within sight of the lane. Once they have all been seen the list resets, so
  // a long-running embed drives the circuit again rather than stopping stopping.
  // The next repository to visit: nearest unvisited building. Once they have all
  // been seen the list resets, so a long-running embed tours the city again
  // rather than driving in circles with nowhere to go.
  function nextStop() {
    let best = null, bestD = Infinity;
    const list = deps.buildings?.() || [];
    for (const b of list) {
      const name = b.repo?.full_name; if (!name || autoCar.seen.has(name)) continue;
      const dx = b.mesh.position.x - car.p.x, dz = b.mesh.position.z - car.p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best && autoCar.seen.size && list.length) { autoCar.seen.clear(); return nextStop(); }
    return best;
  }
  // Steer for a point: the car's heading convention is fx = cos(yaw),
  // fz = -sin(yaw), and positive steer turns yaw negative -- hence both minuses.
  function steerFor(x, z) {
    return clamp(-wrapAngle(Math.atan2(-(z - car.p.z), x - car.p.x) - car.yaw) * AUTO.CAR_GAIN, -1, 1);
  }
  // She drives in off the boulevard to each repository in turn, pulls up at it,
  // opens its guide the way pressing E would, and moves on. The buildings sit
  // well inside the ring, so following the ring alone never got near one.
  function autoDrive(dt) {
    // The guide is on air: the sim is already frozen, so there is nothing to drive.
    if (repoInspector.open) { autoCar.stuck = 0; return NEUTRAL; }
    autoCar.cruise = Math.max(0, autoCar.cruise - dt);
    // Just pulled away from a repository: take the long way round for a few
    // seconds before heading for the next one. Cutting straight from building
    // to building made it a shuttle run; this makes it a drive.
    const stop = autoCar.cruise ? null : nextStop();
    if (!stop) { // cruising, or no buildings yet: keep to the boulevard
      const r = Math.hypot(car.p.x, car.p.z) || 1;
      const a = Math.atan2(car.p.z, car.p.x) + AUTO.CAR_LOOK;
      const aim = layoutBoulevard(Math.cos(a) * r, Math.sin(a) * r);
      if (!aim) return NEUTRAL;
      return { ...NEUTRAL, thr: car.vf < AUTO.CAR_SPEED ? 1 : 0, steer: steerFor(aim.x, aim.z) };
    }
    const tx = stop.mesh.position.x, tz = stop.mesh.position.z;
    const dist = Math.hypot(tx - car.p.x, tz - car.p.z);
    const steer = steerFor(tx, tz);
    // Wedged against a kerb or a corner of a building she cannot round: give up
    // on this one and take the next. Better a skipped repo than a parked film.
    if (Math.abs(car.vf) < 0.5) { autoCar.stuck += dt; } else { autoCar.stuck = 0; }
    if (autoCar.stuck > AUTO.CAR_STUCK && dist > AUTO.CAR_PARK) {
      autoCar.stuck = 0; autoCar.seen.add(stop.repo.full_name);
      return { ...NEUTRAL, thr: -1, steer: -steer }; // back out, and pick another next frame
    }
    if (dist > AUTO.CAR_PARK) {
      // Ease off on the way in so she arrives at a stop rather than through it.
      const want = dist < AUTO.CAR_SLOW ? AUTO.CAR_SPEED * 0.45 : AUTO.CAR_SPEED;
      return { ...NEUTRAL, thr: car.vf < want ? 1 : (car.vf > want * 1.4 ? -0.6 : 0), steer };
    }
    if (car.vf > AUTO.CAR_STOPPED) return { ...NEUTRAL, thr: -1, steer };
    autoCar.seen.add(stop.repo.full_name);
    autoCar.stuck = 0;
    repoInspector.inspect(stop.repo, {
      status: 'PARKED', resumeLabel: 'Drive on ', modal: false,
      note: 'The engine is running.',
    });
    setTimeout(() => {
      repoInspector.close('button');
      autoCar.cruise = AUTO.CAR_CRUISE; // pull away and drive before the next stop
    }, AUTO.CAR_DWELL_MS);
    return NEUTRAL;
  }
  // The plane banks to turn, so the only stick it needs is roll: aim at a point
  // walking around a circle over the city and let simFly's auto-levelling,
  // ceiling, floor and roof-skimming do the rest.
  function autoFly(dt) {
    const a = Math.atan2(plane.p.z, plane.p.x) + AUTO.AIR_LOOK;
    const tx = Math.cos(a) * AUTO.AIR_RADIUS, tz = Math.sin(a) * AUTO.AIR_RADIUS;
    const err = wrapAngle(Math.atan2(-(tz - plane.p.z), tx - plane.p.x) - plane.yaw);
    return { ...NEUTRAL, roll: clamp(-err * AUTO.AIR_GAIN, -1, 1) };
  }
  /** Hand the sticks to the autopilot (embed mode), or give them back. */
  function setAutopilot(on) {
    autopilot = on ? (dt) => (sim === 'drive' ? autoDrive(dt) : sim === 'fly' ? autoFly(dt) : NEUTRAL) : null;
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
  // city.json plane livery: { color: 0xRRGGBB | null, name: string }. The
  // biplane is rebuilt (in place if she's flying) only when it changes.
  function setLivery({ color = null, name = '' } = {}) {
    color = Number.isInteger(color) ? color : null;
    name = typeof name === 'string' ? name : '';
    if (color === livery.color && name === livery.name) return;
    livery = { color, name };
    if (!planeObj) return;
    const flying = !!planeObj.root.parent;
    if (flying) scene.remove(planeObj.root, planeObj.blob);
    planeObj.nameTex?.dispose();
    planeObj.root.traverse((o) => o.geometry?.dispose());
    planeObj.blob.geometry.dispose();
    planeObj = null;
    if (flying) { ensureVehicle('fly'); placePlane(); }
  }

  // ---- mode switching --------------------------------------------------------------
  function beginBlend(dur) {
    blend = { t: 0, dur, pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
  }
  function setMode(next) {
    if (!MODES.includes(next) || next === mode) return;
    if (trip && trip.phase !== 'reveal') return; // mid-hop between islands
    if (game?.active && next !== 'fly') game.exit(); // leaving the plane ends the bomb run (city restored)
    const prev = mode;
    repoInspector.reset();
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
    let g = groundAt(w.p.x, w.p.z);
    // Rooftops are landing surfaces when approached from above.
    for (const b of getBoxes()) {
      if (w.p.x + PLAYER_R > b.min.x && w.p.x - PLAYER_R < b.max.x &&
          w.p.z + PLAYER_R > b.min.z && w.p.z - PLAYER_R < b.max.z &&
          w.p.y >= b.max.y - .05) g = Math.max(g, b.max.y);
    }
    if (input.jump) w.grounded = false;
    if (w.grounded) { if (w.p.y - g > 0.6) w.grounded = false; else w.p.y = g; }
    if (!w.grounded) {
      if (input.jump) w.vy += (UNICORN_CLIMB - w.vy) * damp(dt, 5);
      else w.vy = Math.max(-UNICORN_FALL, w.vy - GRAVITY * dt);
      w.p.y += w.vy * dt;
      if (w.p.y <= g) { w.p.y = g; w.vy = 0; w.grounded = true; }
    }
    const sp = Math.hypot(w.v.x, w.v.z);

    // Somebody to walk as, rather than a pair of eyes.
    //
    // Walking a city you cannot see yourself in reads as a camera on a stick:
    // there is no sense of being a person among the buildings, and no scale to
    // measure them against. The figure is the scale -- a doorway means
    // something once there is a body beside it.
    if (!person) person = buildPerson();
    person.group.visible = true;
    const step = posePerson(person, { speed: sp, dt, airborne: !w.grounded, flying: input.jump });
    person.group.position.set(w.p.x, w.p.y + step, w.p.z);
    // Model faces -Z, which is also the walker's forward at yaw 0.
    person.group.rotation.y = w.yaw;

    w.bob += sp * dt;
    w.fov += ((sp > WALK_SPEED + 1 ? 68 : 63) - w.fov) * damp(dt, 4);

    // Third person: behind and above, looking at the chest rather than the
    // feet, so the camera reads the street ahead and not the pavement.
    const elev = clamp(TP_ELEV - w.pitch, -0.12, 1.15);   // look up, camera drops
    _foc.set(w.p.x, w.p.y + TP_FOCUS, w.p.z);
    const ce = Math.cos(elev);
    let dist = TP_DIST;
    // Pull in rather than push through: a wall behind the shoulder would
    // otherwise put the camera inside a building and the city inside out.
    for (let i = 0; i < 6; i++) {
      _cam.set(_foc.x + Math.sin(w.yaw) * dist * ce, _foc.y + dist * Math.sin(elev), _foc.z + Math.cos(w.yaw) * dist * ce);
      if (!collide(_c.copy(_cam), 0.34, _cam.y - 0.3, _cam.y + 0.3) && _cam.y > groundAt(_cam.x, _cam.z) + 0.45) break;
      dist *= 0.76;
      if (dist < 1.1) break;
    }
    want.pos.copy(_cam);
    want.look.copy(_foc);
    want.quat.setFromRotationMatrix(_m4.lookAt(want.pos, want.look, _up));
    want.fov = w.fov;
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
    // Traffic: we are the heavier car, so they are shunted and we hardly feel it.
    const shunt = bumpTrafficCars(c.p.x, c.p.z, c.v.x, c.v.y, CAR.R + 0.5);
    if (shunt) {
      c.v.x += shunt.x; c.v.y += shunt.z;
      const jolt = Math.min(0.9, 0.22 + shunt.power * 0.09);
      c.bump = Math.max(c.bump, jolt);
      chase.shake = Math.max(chase.shake, jolt);
      if (shunt.power > 1.5 && c.smokeT <= 0) { // a cloud of smoke where we caught them
        c.smokeT = 0.18;
        for (let i = 0; i < 8; i++) {
          puff(shunt.ix + (Math.random() - 0.5) * 1.6, c.y + 0.5 + Math.random(), shunt.iz + (Math.random() - 0.5) * 1.6,
            (Math.random() - 0.5) * 5, 1.4 + Math.random() * 1.6, (Math.random() - 0.5) * 5, 0.6, 0xf6efe1, 0.9);
        }
      }
    }
    c.smokeT -= dt;
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
    const p = plane, zoom = touchFlight() ? 1 : chase.zoom.fly;
    p.throttle = clamp(p.throttle + (input.faster - input.slower) * 0.6 * dt, 0, 1);
    const target = PLANE.MIN + 3 + p.throttle * (PLANE.MAX - PLANE.MIN - 8);
    p.speed += (target - p.speed) * damp(dt, 0.8) - Math.sin(p.pitch) * 7 * dt; // dives speed up, climbs bleed speed
    p.speed = clamp(p.speed, PLANE.MIN, PLANE.MAX);
    // Bank to turn; release the stick and she levels herself out.
    let rollTarget = clamp(input.roll, -1, 1) * 1.0;
    // Soft world bound: past SOFT_R the plane banks itself back toward the island.
    const r = Math.hypot(p.p.x, p.p.z);
    let homeTurn = 0;
    if (p.turnBack > 0) p.turnBack -= dt; // a failed portal hop: bank back toward the island
    // Bomb run: the play area is the city block plus a margin; past it she banks back to the centre.
    const out = game?.active ? sdSlab(p.p.x, p.p.z) - GAME_AREA : 0;
    if (r > PLANE.SOFT_R || p.turnBack > 0 || out > 0) {
      const toC = Math.atan2(p.p.z / r, -p.p.x / r), diff = wrapAngle(toC - p.yaw);
      const kk = p.turnBack > 0 ? 1 : Math.max(clamp((r - PLANE.SOFT_R) / 60, 0, 1), clamp(out / 18, 0, 1));
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
    const playing = game?.state === 'play'; // bomb run: buildings and the ground are for crashing into
    // Buildings: skim over roofs, glance off walls.
    if (!playing) for (const b of getBoxes()) {
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
    if (!playing && p.p.y < floor) {
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
    const p = plane, zoom = touchFlight() ? 1 : chase.zoom.fly;
    chase.idle += dt;
    if (chase.idle > 1.5 && !drag) { chase.yaw *= Math.exp(-dt * 2); chase.pitch *= Math.exp(-dt * 2); }
    const yaw = p.yaw + chase.yaw, pp = p.pitch * 0.6, cp = Math.cos(pp);
    const gm = game?.active ? 1 : 0; // bomb run: pulled back and up so rooftops read
    const back = 13 * zoom * (1 + 0.35 * gm), up = (3.8 + 4 * gm) * zoom + chase.pitch * 8;
    _v.set(p.p.x - cp * Math.cos(yaw) * back, p.p.y - Math.sin(pp) * back + up, p.p.z + cp * Math.sin(yaw) * back);
    const cpf = Math.cos(p.pitch);
    _v2.set(p.p.x + cpf * Math.cos(p.yaw) * 7, p.p.y + Math.sin(p.pitch) * 7 + 0.9, p.p.z - cpf * Math.sin(p.yaw) * 7);
    // On autopilot the plane is circling something worth looking at, so the
    // camera turns inward and keeps the city in frame for the whole circuit
    // instead of staring down the fuselage at open sea. A little of the nose is
    // left in, or the shot loses any sense of which way she is flying.
    if (autopilot) _v2.lerp(_cityEye.set(0, 12, 0), 0.82);
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
// ---------------------------------------------------------------------------
// Autopilot (embed mode): the same sticks, moved by something other than hands.
// ---------------------------------------------------------------------------
// Nothing about the simulation changes -- these return the very input object a
// keyboard would, so the car still understeers, the plane still auto-levels,
// and both keep their collision, terrain and soft-bound handling. Pure pursuit:
// look at a point a little further along the path and steer at it.
const AUTO = {
  CAR_LOOK: 0.20,   // radians of boulevard to look ahead
  CAR_GAIN: 1.6,    // how hard to correct the heading error
  CAR_SPEED: 13,    // of a top speed of 26: quick enough to feel driven, slow enough to hold a corner
  CAR_PARK: 11,     // how close to a building counts as arrived
  CAR_SLOW: 26,     // ...and where to start slowing for it
  CAR_STOPPED: 0.7, // ...and how slow counts as stopped
  CAR_DWELL_MS: 28000,
  CAR_CRUISE: 9,    // seconds of driving the boulevard between stops, so it is a drive and not a shuttle run
  CAR_STUCK: 3.5,   // seconds of going nowhere before giving up on a building
  AIR_RADIUS: 200,  // well inside EDGE_R (320), or the plane leaves for the next island mid-shot
  AIR_LOOK: 0.32,
  AIR_GAIN: 0.9,
};

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

  // ---- neighbour travel: fly off the edge of the island into the next profile -----------
  // deps.world()        -> the world handle: gates (neighbour bearings), gateFor(x, y, z, 'fly')
  //                        (a neighbour once the plane is past the edge), arrival(bearing, 'fly')
  // deps.travel(login)  -> Promise<{ ok, login?, reason? }>, settling once the new city is built
  // The morph is a full-screen shader drawn over the finished frame (postRender): a radial
  // warp with speed streaks and a teal tint, peaking in a cloud whiteout while the next
  // island loads, then unwinding over it. Reduced motion gets a plain crossfade.
  const EDGE_R = 320;                                        // world.gateFor's travel radius
  const getWorld = () => { try { return deps.world?.() || null; } catch { return null; } };
  let trip = null;                                           // { gate, phase: 'cover' | 'load' | 'reveal', t0 }
  let cityReveal = null;
  function revealCity() {
    // Island hops already have their own cover/load/reveal lifecycle.
    if (!trip) cityReveal = { elapsed: 0, lastFrame: null };
  }
  let edgeHint = null;                                       // login shown in the "keep flying" hint
  const guard = { armed: true, t: 0, x0: 0, z0: 0 };         // no instant hop right after arriving
  const COVER_MS = 1100, REVEAL_MS = 1200;
  const warp = el('div', 'gcx-warp', `<div class="gcx-warp-card"><img class="gcx-warp-av" alt="" referrerpolicy="no-referrer">
    <div class="gcx-warp-title"></div><div class="gcx-warp-sub"></div></div>`);
  warp.hidden = true;
  warp.setAttribute('aria-live', 'polite');
  const toastEl = el('div', 'gcx-toast', '');
  toastEl.hidden = true; toastEl.setAttribute('role', 'status');
  document.body.append(warp, toastEl);
  const warpAv = warp.querySelector('.gcx-warp-av'), warpTitle = warp.querySelector('.gcx-warp-title'), warpSub = warp.querySelector('.gcx-warp-sub');
  warpAv.addEventListener('error', () => { warpAv.style.visibility = 'hidden'; });
  injectTravelStyle();
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 5500);
  }
  function armGuard() { Object.assign(guard, { armed: false, t: 0, x0: plane.p.x, z0: plane.p.z }); }
  function startTravel(gate, source = 'edge') { // source: 'edge' | 'next' | 'ui'
    if (trip || typeof deps.travel !== 'function' || !gate?.login) return;
    cityReveal = null;
    deps.onTravelStart?.(); // the host takes down anything naming the island we are leaving
    trip = { gate, mode, source, phase: 'cover', t0: performance.now(), skyDay: deps.dayFactor?.() ?? 1 }; // travel in the current mode
    warpTitle.textContent = `✈ @${gate.login}’s island`;
    warpSub.textContent = gate.via ? `next island · ${gate.via}` : 'next island';
    warpAv.style.visibility = '';
    warpAv.src = gate.avatar || '';
    warp.hidden = false;
    warp.classList.remove('show');
    closeMenu();
    setEdgeHint(null);
    // Everything describing the island we are leaving goes with it, and goes
    // now: the warp covers the screen in well under a second, and a guide still
    // reading out the last city's README while the next one arrives is the
    // clearest way to look broken. Each closes by its own exit animation rather
    // than being switched off, so they leave the way they came in.
    if (repoInspector.open) repoInspector.close();
    endTour();                 // clears the showcase card with it
    closeGource(true);         // animated: the replay folds away rather than blinking out
  }
  // Advance the trip; true while the world is being swapped (hold the sim still).
  function updateTravel() {
    if (!trip) return false;
    const now = performance.now(), t = trip;
    if (t.phase === 'cover' && now - t.t0 >= COVER_MS * 0.75) warp.classList.add('show');
    if (t.phase === 'cover' && now - t.t0 >= COVER_MS) {
      t.phase = 'load';
      Promise.resolve().then(() => deps.travel(t.gate.login))
        .then((r) => arrive(t, r && r.ok !== false, r?.reason), (e) => arrive(t, false, e?.message));
    }
    if (t.phase === 'reveal' && now - t.t0 >= REVEAL_MS) { warp.hidden = true; trip = null; return false; }
    return t.phase === 'load';
  }
  function arrive(t, ok, reason) {
    if (trip !== t) return;
    if (ok) {
      resetColliders();
      // Come out on the far side of the new island, heading inland (heading = atan2(dz, dx)):
      // the plane over the sea with its speed kept, a car / walker on the first dry ground.
      // Orbit needs nothing: the host's loadCity() frames the new city.
      const m = t.mode !== 'orbit' && sim === t.mode ? t.mode : null;
      const a = m ? getWorld()?.arrival?.(t.gate.bearing + Math.PI, m) : null;
      if (a) {
        const h = a.heading;
        if (m === 'fly') {
          plane.p.set(a.x, a.y, a.z); plane.yaw = wrapAngle(-h); plane.pitch = plane.roll = 0; plane.turnBack = 0;
          placePlane(); flyCam(1, true);
        } else if (m === 'drive') {
          car.p.set(a.x, 0, a.z); car.yaw = wrapAngle(-h); car.v.set(0, 0); car.steer = 0;
          car.y = groundAt(a.x, a.z); tiltCar(1); placeCar(); driveCam(1, true);
        } else {
          walker.p.set(a.x, groundAt(a.x, a.z), a.z); walker.yaw = Math.atan2(-Math.cos(h), -Math.sin(h));
          walker.pitch = 0.08; walker.v.set(0, 0, 0); walker.vy = 0; walker.grounded = true;
        }
        chase.yaw = chase.pitch = 0; blend = null;
      }
    } else {
      toast(`Couldn’t reach @${t.gate.login} — ${reason || 'GitHub rate limit'}${t.source === 'edge' ? ', try another direction' : ''}`);
      if (sim === 'fly' && t.source === 'edge') plane.turnBack = 3.2; // bank back toward the island
    }
    if (sim === 'fly') armGuard();
    warp.classList.remove('show');
    // A beat at full whiteout so the new island has rendered, then unwind.
    t.phase = 'reveal'; t.t0 = performance.now() + 150;
  }
  // Effect levels for the current moment: amt = warp strength, white = cloud whiteout.
  let warpOverride = null; // debug: pin the effect for screenshots
  function warpLevels(now) {
    if (warpOverride) return warpOverride;
    if (!trip) {
      if (!cityReveal) return null;
      // Shader compilation can stall the first frame. Advance on rendered
      // frames so the reveal isn't consumed while the GPU prepares the city.
      if (cityReveal.lastFrame !== null) cityReveal.elapsed += Math.min(50, Math.max(0, now - cityReveal.lastFrame));
      cityReveal.lastFrame = now;
      const levels = cityArrivalLevels(cityReveal.elapsed, !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      if (!levels) cityReveal = null;
      return levels;
    }
    const ss = THREE.MathUtils.smoothstep;
    if (trip.phase === 'load') return { amt: 1, white: 1 };
    if (trip.phase === 'cover') { const e = (now - trip.t0) / COVER_MS; return { amt: ss(e, 0, 1), white: ss(e, 0.45, 1) }; }
    const e = Math.max(0, now - trip.t0) / REVEAL_MS;
    return { amt: 1 - ss(e, 0.15, 1), white: 1 - ss(e, 0, 0.6) };
  }
  let warpFx = null;
  function getWarpFx() {
    if (warpFx) return warpFx;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const mat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, uAmt: { value: 0 }, uWhite: { value: 0 }, uOpening: { value: 1 }, uDay: { value: 1 }, uTime: { value: 0 }, uRes: { value: size.clone() }, uReduced: { value: reducedMotion ? 1 : 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: WARP_FRAG, depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const sc = new THREE.Scene();
    sc.add(quad);
    warpFx = { mat, quad, sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), tex: null, size };
    return warpFx;
  }
  // After the host's final render (plain, FX or TV): grab the frame and warp it.
  function postRender() {
    const lv = warpLevels(performance.now());
    if (!lv || (lv.amt < 0.002 && lv.white < 0.002)) return;
    const fx = getWarpFx();
    renderer.getDrawingBufferSize(fx.size);
    if (!fx.tex || fx.tex.image.width !== fx.size.x || fx.tex.image.height !== fx.size.y) {
      fx.tex?.dispose();
      fx.tex = new THREE.FramebufferTexture(fx.size.x, fx.size.y);
      fx.tex.minFilter = fx.tex.magFilter = THREE.LinearFilter;
      fx.tex.generateMipmaps = false;
    }
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(fx.tex);
    const u = fx.mat.uniforms;
    u.tMap.value = fx.tex; u.uAmt.value = lv.amt; u.uWhite.value = lv.white; u.uTime.value = performance.now() / 1000; u.uRes.value.copy(fx.size);
    u.uOpening.value = lv.opening ?? 1;
    // Hold the departure lighting until the destination is built, then fade
    // toward its actual day/night factor as the clouds part. This also follows
    // automatic time, sunset and the day/night cycle, not just a night toggle.
    const destinationDay = THREE.MathUtils.clamp(deps.dayFactor?.() ?? 1, 0, 1);
    const skyBlend = trip?.phase === 'reveal'
      ? THREE.MathUtils.smoothstep((performance.now() - trip.t0) / REVEAL_MS, 0, 0.55) : 0;
    u.uDay.value = trip ? THREE.MathUtils.lerp(trip.skyDay, destinationDay, skyBlend) : destinationDay;
    u.uReduced.value = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : 0;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(fx.sc, fx.cam);
    renderer.autoClear = auto;
  }
  function setEdgeHint(login) {
    if (login === edgeHint) return;
    edgeHint = login;
    if (mode === 'orbit') return;
    hintEl.innerHTML = login ? `Keep flying to reach <b>@${escapeText(login)}</b>’s island →` : game?.active ? HINTS.game() : HINTS[mode]();
  }
  const escapeText = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function checkGates(dt) {
    if (sim !== 'fly' || mode !== 'fly' || exiting || trip || game?.active) { setEdgeHint(null); return; } // no island hops mid-game
    const W = getWorld(), gs = W?.gates || [];
    const r = Math.hypot(plane.p.x, plane.p.z);
    if (!guard.armed) {
      guard.t += dt;
      if (guard.t >= 4 && (r < EDGE_R - 25 || Math.hypot(plane.p.x - guard.x0, plane.p.z - guard.z0) > 90)) guard.armed = true;
    }
    // No neighbours yet, cooling down, or no host: the soft bound (330) turns the plane back as before.
    if (!guard.armed || typeof deps.travel !== 'function' || typeof W?.gateFor !== 'function' || !gs.length) { setEdgeHint(null); return; }
    const g = r > EDGE_R ? W.gateFor(plane.p.x, plane.p.y, plane.p.z, 'fly') : null;
    if (g) { startTravel(g); return; }
    // Nearing the edge: name the island ahead (the neighbour on the closest bearing).
    let near = null;
    if (r > EDGE_R - 40) {
      const b = Math.atan2(plane.p.z, plane.p.x);
      let bd = Infinity;
      for (const n of gs) { const d = Math.abs(wrapAngle(n.bearing - b)); if (d < bd) { bd = d; near = n.login; } }
    }
    setEdgeHint(near);
  }
  // "✈ Next island": fly to the neighbour the camera faces, from any mode (button, HUD, N key).
  const _nd = new THREE.Vector3();
  function nextGate() {
    const gs = getWorld()?.gates || [];
    if (!gs.length) return null;
    camera.getWorldDirection(_nd);
    const b = Math.atan2(_nd.z, _nd.x);
    return gs.reduce((best, g) => (Math.abs(wrapAngle(g.bearing - b)) < Math.abs(wrapAngle(best.bearing - b)) ? g : best));
  }
  // Only a plane is seen heading off; orbit / walk / drive morph in place and come back in the same mode.
  function flyToNext() {
    if (trip || exiting || game?.active) return;
    const g = nextGate();
    if (!g || typeof deps.travel !== 'function') { toast('No neighbouring islands yet — try again in a moment'); return; }
    if (mode === 'fly') { plane.yaw = wrapAngle(-g.bearing); plane.pitch = 0.05; } // point her out to sea, toward that island
    startTravel(g, 'next');
  }
  const nextBtns = [];
  function makeNext(cls, html) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.innerHTML = html; b.disabled = true;
    b.addEventListener('click', (e) => { e.stopPropagation(); flyToNext(); b.blur(); });
    nextBtns.push(b);
    return b;
  }
  if (button) button.insertAdjacentElement('afterend', makeNext('tb gcx-next', '✈ Next<span class="gcx-lbl-wide"> island</span>'));
  hud.querySelector('.gcx-exit').before(makeNext('gcx-next-hud', '✈<span class="gcx-lbl"> Next island</span>'));
  let nextAt = 0;
  function updateNextTitle() { // wall-clock throttle: slow frames must not keep the button disabled
    const now = performance.now();
    if (now < nextAt) return;
    nextAt = now + 400;
    const g = nextGate(), title = g ? `Go to @${g.login}’s island (N)` : 'Next island (N): neighbours are still loading';
    for (const b of nextBtns) { if (b.title !== title) b.title = title; b.disabled = !g || !!trip || !!game?.active; }
  }

  // Any profile change (search box, chips, Next island) travels through the same warp and
  // comes back in the same mode. The bearing is the neighbour's, else where the camera faces.
  function travelTo(login, opts = {}) {
    login = String(login || '').trim().replace(/^@/, '');
    if (!login || typeof deps.travel !== 'function') return false;
    if (game?.active) game.exit(); // a new island ends the bomb run (city restored first)
    if (trip || exiting) return true; // one hop at a time
    const known = (getWorld()?.gates || []).find((g) => g.login.toLowerCase() === login.toLowerCase());
    let bearing = opts.bearing ?? known?.bearing;
    if (bearing == null) { camera.getWorldDirection(_nd); bearing = Math.atan2(_nd.z, _nd.x); }
    const gate = { login, bearing, via: opts.via ?? known?.via ?? '',
      avatar: opts.avatar ?? known?.avatar ?? `https://github.com/${encodeURIComponent(login)}.png?size=128` };
    if (mode === 'fly') { plane.yaw = wrapAngle(-bearing); plane.pitch = 0.05; }
    startTravel(gate, opts.source || 'ui');
    return true;
  }
  function travelCleanup() {
    clearTimeout(toastTimer);
    for (const b of nextBtns) b.remove();
    for (const n of [warp, toastEl]) n.remove();
    if (warpFx) { warpFx.tex?.dispose(); warpFx.mat.dispose(); warpFx.quad.geometry.dispose(); warpFx = null; }
  }

  // ---- bomb run (game.js): shoot and bomb the city from the plane ------------------------
  // Offered in every explore mode (HUD button, G): it takes the plane and plays over the
  // city block; a crash hides and freezes the plane until Play again / Exit.
  const GAME_AREA = 50; // play area: the paved block plus this margin; past it she banks home
  const gameView = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 1, fy: 0, fz: 0, rx: 0, rz: 1, speed: 0 };
  function planeShown(v) { if (planeObj) { planeObj.root.visible = v; planeObj.blob.visible = v; } }
  // Just outside the block on the camera's side, above the tallest roof, heading for the centre.
  function spawnForGame(top = 24) {
    const b = Math.hypot(camera.position.x, camera.position.z) > 1 ? Math.atan2(camera.position.z, camera.position.x) : 0.8;
    let R = 40;
    while (R < 400 && sdSlab(Math.cos(b) * R, Math.sin(b) * R) < 24) R += 2;
    plane.p.set(Math.cos(b) * R, Math.max(top + 14, 30), Math.sin(b) * R);
    plane.yaw = Math.atan2(Math.sin(b), -Math.cos(b)); plane.pitch = -0.04; plane.roll = 0;
    plane.speed = 24; plane.throttle = 0.4; plane.turnBack = 0; plane.bump = 0;
    planeFrozen = false; planeShown(true);
    chase.yaw = chase.pitch = 0; chase.shake = 0;
    beginBlend(0.7); placePlane(); flyCam(1, true);
  }
  game = createBombRun(THREE, {
    scene, camera, ink, reducedMotion, seaY: SEA_Y, groundAt, toon: (hex) => toon(hex),
    buildings: () => { try { return deps.buildings?.() || []; } catch { return []; } },
    login: () => { try { return deps.login?.() || ''; } catch { return ''; } },
    outside: (x, z) => sdSlab(x, z) - GAME_AREA,
    obstacles: [{ x: 0, z: 0, r: 2.4, h: 16 }, { x: 0, z: 0, r: 4.7, h: 1.9 }], // the plaza monument: pillar and steps
    input: () => {
      gameInput.fire = !!(keys.has('Space') || gameMouse.fire || acts.has('fire'));
      gameInput.bomb = !!(keys.has('KeyB') || gameMouse.bomb || acts.has('bomb'));
      return gameInput;
    },
    shake: (a) => { chase.shake = Math.max(chase.shake, a); },
    plane: {
      state() {
        const p = plane, cp = Math.cos(p.pitch), v = gameView;
        v.x = p.p.x; v.y = p.p.y; v.z = p.p.z; v.speed = planeFrozen ? 0 : p.speed;
        v.fx = cp * Math.cos(p.yaw); v.fy = Math.sin(p.pitch); v.fz = -cp * Math.sin(p.yaw);
        v.vx = v.fx * v.speed; v.vy = v.fy * v.speed; v.vz = v.fz * v.speed;
        v.rx = Math.sin(p.yaw); v.rz = Math.cos(p.yaw);
        return v;
      },
      crash() { planeFrozen = true; planeShown(false); },
      respawn({ top } = {}) { spawnForGame(top); },
      release() { if (planeFrozen) spawnForGame(); planeFrozen = false; planeShown(true); },
    },
    onStart: () => { closeMenu(); try { deps.onGameStart?.(); } catch (err) { console.error(err); } },
    // End-card repo link: the city is restored by exit(), then orbit, then the host's showcase tour to it.
    onRepo: (fullName) => {
      game.exit();
      if (mode !== 'orbit') setMode('orbit');
      try { deps.tourToRepo?.(fullName); } catch (err) { console.error(err); }
    },
    onChange: () => syncUI(),
  });
  function startGame() {
    if (!game || game.active || trip || exiting) return;
    if (mode !== 'fly') setMode('fly');
    if (mode !== 'fly') return;
    game.start();
  }
  const gameBtn = document.createElement('button');
  gameBtn.type = 'button'; gameBtn.className = 'gcx-game';
  gameBtn.title = 'Bomb run: shoot and bomb the city from the plane (G)';
  gameBtn.innerHTML = '🎮<span class="gcx-lbl"> Bomb run</span>';
  gameBtn.addEventListener('click', (e) => { e.stopPropagation(); startGame(); gameBtn.blur(); });
  hud.querySelector('.gcx-exit').before(gameBtn);
  const onCtx = (e) => { if (game?.active && e.target === canvas) e.preventDefault(); }; // right-click bombs
  canvas.addEventListener('contextmenu', onCtx);

  // ---- public ---------------------------------------------------------------------------
  function update(dt, elapsed = 0) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    updatePuffs(dt);
    const swapping = updateTravel(); // portal trip: hold still while the next island is built
    updateNextTitle(dt);
    if (mode === 'orbit' && !exiting) return false;
    if (swapping) return true;
    if (needUnstick && sim) {
      needUnstick = false;
      if (sim === 'walk') {
        if (!onLand(walker.p.x, walker.p.z)) spawnWalk();
        collide(walker.p, PLAYER_R, walker.p.y + 0.2, walker.p.y + 1.8);
      } else if (sim === 'drive') {
        if (!onLand(car.p.x, car.p.z)) spawnDrive(); else unstickCar();
      }
    }
    const input = exiting ? NEUTRAL : (autopilot ? autopilot(dt) : readInput());
    // The figure belongs to walk mode only: driving past yourself standing in
    // the road, or seeing yourself from the plane, would be a ghost.
    if (person && sim !== 'walk') person.group.visible = false;
    if (repoInspector.open) { /* Hold position and camera while reading repo details. */ }
    else if (sim === 'walk') simWalk(dt, input);
    else if (sim === 'drive') simDrive(dt, input);
    else if (sim === 'fly') { if (planeFrozen) flyCam(dt, false); else simFly(dt, input, elapsed); }
    if (game?.active && sim === 'fly' && !exiting) game.update(dt); // bomb run (game.js)
    if (!exiting) checkGates(dt); // reached a portal gate? start the trip to that island
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
    repoInspector.update(dt, exiting ? 'orbit' : mode, mode === 'walk' ? walker.p : car.p);
    return true;
  }
  function resetColliders() { repoInspector.reset(); syncDims(); boxes = null; needUnstick = !!sim; game?.resync(); }
  function dispose() {
    disposePerson(person); person = null;
    repoInspector.dispose();
    game?.dispose();
    canvas.removeEventListener('contextmenu', onCtx);
    travelCleanup();
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    canvas.removeEventListener('wheel', onWheel);
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.removeEventListener(t, onGesture);
    document.removeEventListener('touchmove', onTouchMove);
    removeEventListener('pointerdown', onPointerDown, cap);
    removeEventListener('pointermove', onPointerMove, cap);
    removeEventListener('pointerup', onPointerUp, cap);
    document.removeEventListener('pointerdown', onDocDown, cap);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onLockChange);
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
    wantsKey(e) {
      // The field guide is a panel, not a mode: it claims only the keys it uses
      // (R, H, E, Esc) so the city keeps ← → T space and the rest while it is open.
      if (repoInspector.open) return e.code === 'KeyR' || e.code === 'KeyH' || e.code === 'KeyE' || e.key === 'Escape';
      return mode !== 'orbit' && e.key !== 'Escape' && e.key !== 'v' && e.key !== 'V';
    },
    update, postRender, dispose, resetColliders, flyToNext, travelTo, revealCity, setAutopilot,
    inspectRepo(repo, options) { return repoInspector.inspect(repo, options); },
    closeInspector(reason) { repoInspector.close(reason); },
    /** Tour hop: hold the field guide open (veiled) while the camera flies to the next repo. */
    transitInspector(repo) { return repoInspector.transit(repo); },
    get inspectorOpen() { return repoInspector.open; },
    startGame, get game() { return game; },
    groundAt, setLivery,
    /** Debug / test hooks: collider count, box list, and teleporting the active walker / car. */
    debug: {
      boxes: () => getBoxes().map((b) => ({ min: b.min.toArray(), max: b.max.toArray() })),
      place(x, z, yaw = 0) {
        if (sim === 'walk') { walker.p.set(x, groundAt(x, z), z); walker.yaw = yaw; walker.v.set(0, 0, 0); }
        else if (sim === 'drive') { car.p.set(x, 0, z); car.yaw = yaw; car.v.set(0, 0); car.y = groundAt(x, z); }
        guard.armed = true;
      },
      fly(x, y, z, yaw = 0, arm = true) { if (sim === 'fly') { plane.p.set(x, y, z); plane.yaw = yaw; plane.pitch = plane.roll = 0; if (arm) guard.armed = true; } },
      trip: () => (trip ? { login: trip.gate.login, phase: trip.phase, mode: trip.mode } : null),
      armed: () => guard.armed,
      warp(levels) { warpOverride = levels ? { amt: +levels.amt || 0, white: +levels.white || 0, opening: levels.opening ?? 1 } : null; },
    },
    get state() { return { mode, sim, car: { x: car.p.x, y: car.y, z: car.p.z, speed: car.vf, pitch: car.pitch, roll: car.roll }, plane: { ...plane.p, speed: plane.speed, roll: plane.roll, pitch: plane.pitch }, walker: { ...walker.p } }; },
  };
}
