/*
 * Gitilla — the sponsor plane: like the banner planes over tourist beaches, a
 * little prop plane tows a banner that nudges visitors to support Gitilla on
 * Buy Me a Coffee. It flies across whatever the camera is looking at, then keeps
 * circling the city. Clicking
 * the plane or its banner opens the Buy Me a Coffee widget (loaded by
 * index.html); without the widget, the page opens in a new tab.
 */
import * as THREE from 'three';
import { scene, camera, cityGroup } from './scene.js';
import { toonMat, getOutlineMat, hullOf, noRaycast } from './toon.js';

const SUPPORT_URL = 'https://buymeacoffee.com/schlunsen';
const TEXT = 'Enjoying Gitilla?  Buy me a coffee ☕';
// Real seconds, not frame steps: a flypast takes the same time however fast the page renders.
const FLIGHT_SPEED = 11;                    // world units per second around the city
const FIRST_WAIT = 6;                       // the first pass comes soon after the city is up
const SCALE = 2.1;                          // the plane model is ~5 units long before scaling
const BANNER_W = 22, BANNER_H = 2.9, SEGS = 28, GAP = 3.5; // banner size, cloth segments, tow-line length

let rig = null; // { plane, prop, banner, front, back, rope, pickables, start, next, flying }
const now = () => performance.now() / 1000;

function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 1536; c.height = 202;
  const g = c.getContext('2d');
  g.fillStyle = '#fdf6e3'; g.fillRect(0, 0, c.width, c.height);
  g.lineWidth = 14; g.strokeStyle = '#1a2233'; g.strokeRect(7, 7, c.width - 14, c.height - 14);
  g.fillStyle = '#e4574f'; g.fillRect(16, 16, 20, c.height - 32); g.fillRect(c.width - 36, 16, 20, c.height - 32);
  g.fillStyle = '#1a2233'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let px = 112;
  const font = () => `800 ${px}px ui-rounded, "Nunito", "Trebuchet MS", system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  g.font = font();
  while (g.measureText(TEXT).width > c.width - 130 && px > 40) { px -= 4; g.font = font(); }
  g.fillText(TEXT, c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Small painted details, drawn once: crisp enough for the close flypast without
// adding geometry or competing with the banner at city scale.
function planePaint(wing = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = wing ? '#f6f1e4' : '#64dedb';
  ctx.fillRect(0, 0, 512, 512);
  if (wing) {
    // Box top UVs run along the span vertically: paired painted tip bands.
    for (const y of [30, 450]) {
      ctx.fillStyle = '#419f9e'; ctx.fillRect(0, y, 512, 26);
      ctx.fillStyle = '#f2c14e'; ctx.fillRect(0, y + 29, 512, 7);
    }
    ctx.strokeStyle = 'rgba(47,53,66,0.16)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(105, 65); ctx.lineTo(105, 447);
    for (let y = 90; y < 440; y += 55) {
      ctx.moveTo(18, y); ctx.lineTo(494, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(47,53,66,0.23)';
    for (let y = 80; y < 442; y += 22) {
      ctx.beginPath(); ctx.arc(116, y, 2, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // Capsule UV v follows the fuselage; u wraps around it. Two lengthwise
    // cream pinstripes give both sides a little vintage aircraft character.
    for (const x of [112, 368]) {
      ctx.fillStyle = '#f6f1e4'; ctx.fillRect(x, 0, 28, 512);
      ctx.fillStyle = '#e8bd62'; ctx.fillRect(x + 30, 0, 6, 512);
    }
    ctx.fillStyle = 'rgba(47,53,66,0.12)';
    for (const y of [125, 385]) ctx.fillRect(0, y, 512, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function planeRelief(wing = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 512, 512);
  // Height is independent of paint: the decorative stripes stay smooth.
  ctx.strokeStyle = '#747474'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (wing) {
    ctx.moveTo(105, 65); ctx.lineTo(105, 447);
    for (let y = 90; y < 440; y += 55) {
      ctx.moveTo(18, y); ctx.lineTo(494, y);
    }
  } else {
    for (const y of [125, 385]) {
      ctx.moveTo(0, y); ctx.lineTo(512, y);
    }
  }
  ctx.stroke();
  ctx.fillStyle = '#929292';
  if (wing) {
    for (let y = 80; y < 442; y += 22) {
      ctx.beginPath(); ctx.arc(116, y, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace; // height data, not sRGB paint
  texture.anisotropy = 8;
  return texture;
}

// A cartoon prop plane in the island's toon style. Local frame: +x is the nose, y up.
function buildPlaneModel() {
  const g = new THREE.Group();
  const teal = toonMat({ color: 0x64dedb }), cream = toonMat({ color: 0xf6f1e4 }), dark = toonMat({ color: 0x2f3542 });
  const yellow = toonMat({ color: 0xf2c14e }), glass = toonMat({ color: 0x9ad3ea });
  const bodyPaint = toonMat({ map: planePaint(), bumpMap: planeRelief(), bumpScale: 0.035 });
  const wingPaint = toonMat({ map: planePaint(true), bumpMap: planeRelief(true), bumpScale: 0.025 });
  const wingFaces = [cream, cream, wingPaint, wingPaint, cream, cream];
  const pickables = [];
  const add = (geo, mat, ink = 0.12) => {
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    pickables.push(m);
    if (ink) { const h = new THREE.Mesh(hullOf(geo, ink), getOutlineMat()); h.raycast = noRaycast; g.add(h); }
    return m;
  };
  add(new THREE.CapsuleGeometry(0.55, 3.2, 6, 12).rotateZ(Math.PI / 2), bodyPaint, 0.14);                     // fuselage
  add(new THREE.BoxGeometry(1.3, 0.12, 6.6).translate(0.35, 0.12, 0), wingFaces, 0.12);                         // wing
  add(new THREE.BoxGeometry(0.8, 0.08, 2.5).translate(-2.05, 0.28, 0), cream, 0.1);                             // tailplane
  add(new THREE.BoxGeometry(0.9, 1.15, 0.1).translate(-2.15, 0.8, 0), teal, 0.1);                               // fin
  add(new THREE.CylinderGeometry(0.44, 0.52, 0.36, 14).rotateZ(Math.PI / 2).translate(2.08, 0, 0), yellow, 0.1); // cowling
  add(new THREE.SphereGeometry(0.44, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.45, 0.46, 0), glass, 0.08); // canopy
  add(new THREE.BoxGeometry(0.08, 0.62, 1.15).translate(0.9, -0.62, 0), dark, 0);                               // undercarriage
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.21, 0.21, 0.14, 12).rotateX(Math.PI / 2).translate(0.9, -0.96, s * 0.58), dark, 0);
  const prop = new THREE.Group();
  prop.position.set(2.32, 0, 0);
  g.add(prop);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.3, 0.18), dark);
  const blade2 = blade.clone();
  blade2.rotation.x = Math.PI / 2;
  prop.add(blade, blade2, new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), yellow));
  // A generous invisible hit box: at flying height the plane is only a few pixels long.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 7), new THREE.MeshBasicMaterial({ visible: false }));
  g.add(hit);
  pickables.push(hit);
  g.scale.setScalar(SCALE);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { group: g, prop, pickables };
}

export function buildBannerPlane() {
  if (rig) return;
  const { group: plane, prop, pickables } = buildPlaneModel();
  const tex = bannerTexture();
  const mat = toonMat({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }); // readable at dusk too
  const front = new THREE.Mesh(new THREE.PlaneGeometry(BANNER_W, BANNER_H, SEGS, 6), mat);
  // A second face for the other side. Turning it round already reverses it for a
  // viewer over there, so its uvs stay as they are: mirroring them too would
  // flip the text back and it would read backwards from that side.
  const backGeo = new THREE.PlaneGeometry(BANNER_W, BANNER_H, SEGS, 6);
  const back = new THREE.Mesh(backGeo, mat);
  back.rotation.y = Math.PI;
  for (const mesh of [front, back]) {
    mesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.boundingSphere.radius += 1; // include the cloth's animated edges for picking/culling
  }
  const banner = new THREE.Group();
  banner.add(front, back);
  // The leading pole the banner hangs from (a weight at its foot keeps it upright) ...
  const rigMat = toonMat({ color: 0x2f3542 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, BANNER_H + 0.7, 8), rigMat);
  pole.position.x = BANNER_W / 2 + 0.12;
  const weight = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), rigMat);
  weight.position.set(BANNER_W / 2 + 0.12, -(BANNER_H + 0.7) / 2, 0);
  banner.add(pole, weight);
  // ... and the tow line from the plane's tail to the middle of that pole: a thin rope you can see.
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6).translate(0, 0.5, 0), rigMat);
  rope.frustumCulled = false;
  rope.raycast = noRaycast;
  scene.add(plane, banner, rope);
  rig = { plane, prop, banner, front, back, rope, pickables: [...pickables, front, back], start: 0, flying: false, next: now() + FIRST_WAIT, radius: 110, altitude: 70, phase: 0, center: new THREE.Vector3() };
  updateBannerPlane(0, 0, false);
}

const _p = new THREE.Vector3(), _b = new THREE.Vector3(), _tail = new THREE.Vector3(), _lead = new THREE.Vector3(), _dir = new THREE.Vector3();
const _dirXZ = new THREE.Vector3();
const _vf = new THREE.Vector3(), _vs = new THREE.Vector3(), _vc = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
// Wind travels from the fixed pole to the loose hem. Broad billows carry
// smaller folds; the height variation keeps this from looking like a rigid
// sheet waving as one. UVs supply rest coordinates, so deformation never drifts.
function flutter(mesh, time, sign) {
  const pos = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), u = (BANNER_W / 2 - sign * x) / BANNER_W; // 0 at the rope end, 1 at the free end
    const v = uv.getY(i) - 0.5;
    const loose = u * u;
    const gust = 0.85 + 0.15 * Math.sin(time * 0.73);
    const billow = Math.sin(u * 8.5 - time * 4.6 + v * 0.8) * 0.38 * u;
    const fold = Math.sin(u * 19 - time * 7.1 - v * 2.4) * 0.085 * loose;
    const curl = Math.sin(u * 12 - time * 5.3 + v * 4) * 0.10 * loose * (v * v * 4);
    pos.setZ(i, (billow + fold + curl) * gust * sign);
    pos.setY(i, v * BANNER_H - 0.16 * loose
      + Math.sin(u * 9 - time * 4.6 + v) * 0.065 * loose);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

// Establish a city-centred circuit once, independent of the follow camera.
function planPass() {
  const bounds = new THREE.Box3().setFromObject(cityGroup);
  if (!bounds.isEmpty()) {
    bounds.getCenter(rig.center).setY(0);
    rig.radius = Math.max(85, Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2 + 18);
    rig.altitude = Math.max(60, bounds.max.y + 16);
  }
  rig.phase = Math.atan2(camera.position.z - rig.center.z, camera.position.x - rig.center.x);
  rig.start = now();
  rig.flying = true;
}

function circuitPoint(angle, target) {
  return target.set(rig.center.x + rig.radius * Math.cos(angle),
    rig.altitude + 0.65 * Math.sin(angle * 2),
    rig.center.z + rig.radius * Math.sin(angle));
}

export function updateBannerPlane(dt, elapsed, hidden) {
  if (!rig) return;
  if (hidden) { rig.plane.visible = rig.banner.visible = rig.rope.visible = false; return; }
  if (!rig.flying) { // wait only before the first arrival
    rig.plane.visible = rig.banner.visible = rig.rope.visible = false;
    if (now() < rig.next) return;
    planPass();
  }
  const age = now() - rig.start;
  const angularSpeed = FLIGHT_SPEED / rig.radius;
  const angle = rig.phase + age * angularSpeed;
  rig.plane.visible = rig.banner.visible = rig.rope.visible = true;
  circuitPoint(angle, _p);
  rig.plane.position.copy(_p);
  _dirXZ.set(-Math.sin(angle), 0, Math.cos(angle));
  const yaw = Math.atan2(-_dirXZ.z, _dirXZ.x);
  const climbSpeed = 1.3 * angularSpeed * Math.cos(angle * 2);
  rig.plane.rotation.set(0, 0, 0);
  rig.plane.rotateY(yaw);
  rig.plane.rotateZ(Math.atan2(climbSpeed, FLIGHT_SPEED));
  rig.plane.rotateX(Math.atan2(FLIGHT_SPEED * angularSpeed, 9.81));
  rig.prop.rotation.x += dt * 38;
  // The cloth follows an earlier point on the same circuit. Aim its leading
  // pole toward the tail while keeping the lettering upright through turns.
  const lag = SCALE * 2.6 + GAP + BANNER_W / 2;
  circuitPoint(angle - lag / rig.radius, _b);
  _b.y -= 2.2;
  rig.banner.position.copy(_b);
  _dir.subVectors(_p, _b);
  rig.banner.rotation.set(0, Math.atan2(-_dir.z, _dir.x), 0);
  flutter(rig.front, age, 1);
  flutter(rig.back, age, -1);
  // The tow line: from the plane's tail to the middle of the banner's leading pole.
  rig.plane.updateMatrixWorld();
  rig.banner.updateMatrixWorld();
  _tail.set(-2.5, 0, 0).applyMatrix4(rig.plane.matrixWorld);
  _lead.set(BANNER_W / 2 + 0.12, 0, 0).applyMatrix4(rig.banner.matrixWorld);
  _dir.subVectors(_lead, _tail);
  const len = _dir.length();
  rig.rope.position.copy(_tail);
  rig.rope.quaternion.setFromUnitVectors(_up, _dir.divideScalar(len || 1));
  rig.rope.scale.set(1, len, 1);
}

// Is the pointer ray on the plane or its banner?
export function bannerPlaneHit(raycaster) {
  return !!rig && rig.plane.visible && raycaster.intersectObjects(rig.pickables, false).length > 0;
}

// Where to put the camera to read the banner: off to one side of it, a little above.
const VIEW_SIDE = 30, VIEW_BACK = 4, VIEW_UP = 2.5;
const _vu = new THREE.Vector3(0, 1, 0), _vd = new THREE.Vector3(), _vr = new THREE.Vector3();
// The support panel opens against the right edge and would sit right on top of
// the banner. How much of the width it covers, 0..1 — the flypast is framed in
// what is left instead. A panel wide enough to be a full sheet (a phone) leaves
// nothing to aim at, so the shot stays as it was.
function supportCover() {
  const panel = document.getElementById('bmc-iframe');
  if (!panel || panel.hidden) return 0;
  const box = panel.getBoundingClientRect();
  const width = window.innerWidth || 1;
  if (box.width < 40 || box.right < width * 0.6) return 0; // closed, or not on the right
  const covered = Math.min(box.width, width - box.left) / width;
  return covered > 0.55 ? 0 : covered;
}
export function bannerPlaneView(eye, look, watchTime = 0) {
  if (!rig || !rig.flying) return false;
  rig.banner.updateMatrixWorld();
  look.setFromMatrixPosition(rig.banner.matrixWorld);
  _vf.set(1, 0, 0).applyQuaternion(rig.banner.quaternion); // along the run
  _vs.set(-_vf.z, 0, _vf.x);
  // Watch from outside the circuit, looking inward over the banner toward
  // the city. Camera position must not decide the side: that could leave the
  // rising shot looking out to sea for the whole flight.
  if (_vs.dot(_vc.subVectors(look, rig.center).setY(0)) < 0) _vs.negate();
  const cover = supportCover();
  // Stand off further as well, so the whole banner still fits across the
  // narrower strip of city the panel leaves behind.
  // A small arc alongside the plane, eased in after the approach. Stay on
  // this side of the banner so the lettering remains readable throughout.
  const enter = Math.min(1, Math.max(0, watchTime / 3));
  const ease = enter * enter * (3 - 2 * enter);
  const arc = Math.sin(watchTime * 0.24) * 0.16 * ease;
  const distance = VIEW_SIDE * (1 + cover * 1.5);
  // First settle alongside, then climb over eight seconds to a three-quarter
  // overhead view. Keep the viewing radius steady as the camera rises.
  const climb = Math.min(1, Math.max(0, (watchTime - 3) / 8));
  const climbEase = climb * climb * (3 - 2 * climb);
  const elevation = climbEase * Math.PI / 5; // 36 degrees: wings visible, banner still readable
  const horizontal = distance * Math.cos(elevation);
  eye.copy(look)
    .addScaledVector(_vs, horizontal * Math.cos(arc))
    .addScaledVector(_vf, -VIEW_BACK + horizontal * Math.sin(arc));
  eye.y = look.y + VIEW_UP + distance * Math.sin(elevation)
    + Math.sin(watchTime * 0.31) * 0.8 * ease;
  if (cover > 0) {
    // Aim to the right of the banner by exactly the strip the panel covers, and
    // the plane rides in the middle of what the visitor can actually see.
    _vd.subVectors(look, eye).normalize();
    _vr.crossVectors(_vd, _vu).normalize(); // screen right
    const halfWidth = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect * eye.distanceTo(look);
    look.addScaledVector(_vr, halfWidth * cover);
  }
  return true;
}

// Kept for the shared follow-camera entry point: the circuit now runs indefinitely.
export function holdBannerPass() {
  return !!rig && rig.flying;
}

export function bannerPlaneFlying() { return !!rig && rig.flying; }

// Bring the plane round now instead of waiting out its rest (the coffee button asks for this).
export function summonBannerPlane() {
  if (!rig || rig.flying) return false;
  rig.next = now();
  return true;
}

// Open the Buy Me a Coffee widget (index.html loads it); the page itself if it's unavailable.
export function openSupport() {
  const btn = document.getElementById('bmc-wbtn');
  if (btn) { btn.click(); return; }
  window.open(SUPPORT_URL, '_blank', 'noopener');
}
