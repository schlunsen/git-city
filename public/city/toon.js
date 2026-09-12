/*
 * The toon look shared by everything built in the city: cel-shaded materials on
 * a 4-step ramp, inverted-hull ink outlines, the night/day environment palette,
 * geometry helpers, a couple of canvas helpers and the seeded random source.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashStr, seededRandom } from './prng.js';

export { hashStr, seededRandom }; // canonical home is prng.js (pure); re-exported for existing importers

// ---------------------------------------------------------------------------
// Toon look: cel-shaded materials on a shared 4-step ramp, black inverted-hull
// outlines, and an environment palette that lerps between night and day.
// ---------------------------------------------------------------------------
let toonRamp = null;
function getToonRamp() {
  if (!toonRamp) {
    // Four lighting bands: shadow, mid, lit, highlight.
    const data = new Uint8Array([98, 98, 98, 255, 152, 152, 152, 255, 218, 218, 218, 255, 255, 255, 255, 255]);
    toonRamp = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
    toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.generateMipmaps = false;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}
export function toonMat(opts = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: getToonRamp(), ...opts });
}
let outlineMat = null;
export function getOutlineMat() {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0d16, side: THREE.BackSide });
    outlineMat.userData.shared = true; // never disposed with a building
  }
  return outlineMat;
}
// Inverted hull: a back-face copy of the box grown by `t` world units. Invisible
// to the raycaster so it never steals hover/click from the body it wraps.
export function outlineBox(w, h, d, t = 0.3) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w + t, h + t, d + t), getOutlineMat());
  m.raycast = () => {};
  return m;
}
// Decorative meshes (plaza, cars) opt out of picking with this no-op.
export const noRaycast = () => {};
export const TAU = Math.PI * 2;
export function box(w, h, d, x = 0, y = 0, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}
// Inverted-hull copy of any part, scaled about its own centre so the ink rim
// is about t/2 thick on each side. Works for rounded and tapered shapes too.
export function hullOf(g, t) {
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3()), s = g.boundingBox.getSize(new THREE.Vector3());
  return g.clone().translate(-c.x, -c.y, -c.z)
    .scale((s.x + t) / s.x, (s.y + t) / s.y, (s.z + t) / s.z).translate(c.x, c.y, c.z);
}
// Merge static parts into one geometry (one draw call). With `colored`, parts
// are [geometry, hex] pairs baked into a vertex colour attribute so a single
// vertexColors material paints them all. The result is flagged shared.
export function mergeParts(parts, colored = false) {
  const geos = parts.map(p => {
    const g = colored ? p[0] : p;
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    if (colored) {
      const col = new THREE.Color(p[1]), a = new Float32Array(n.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) col.toArray(a, i);
      n.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    return n;
  });
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  merged.userData.shared = true;
  return merged;
}
// Flat ring extruded upward from y = 0 (pool rim, plaza kerb).
export function annulusGeo(rIn, rOut, h, seg = 36) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, 0, TAU, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, TAU, true);
  s.holes.push(hole);
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg }).rotateX(-Math.PI / 2);
}
export const envPalette = []; // { mat, night, day } — recoloured every frame by applyDayFactor
export function envMat(night, day, extra = {}) {
  const m = toonMat({ color: night, ...extra });
  envPalette.push({ mat: m, night: new THREE.Color(night), day: new THREE.Color(day) });
  return m;
}


export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function makeGlowTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
