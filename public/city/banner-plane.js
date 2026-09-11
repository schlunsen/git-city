/*
 * Gitilla — the sponsor plane: like the banner planes over tourist beaches, a
 * little prop plane tows a banner that nudges visitors to support Gitilla on
 * Buy Me a Coffee. It flies across whatever the camera is looking at, then goes
 * away for a while and comes back the other way. Clicking
 * the plane or its banner opens the Buy Me a Coffee widget (loaded by
 * index.html); without the widget, the page opens in a new tab.
 */
import * as THREE from 'three';
import { scene, camera, controls } from './scene.js';
import { toonMat, getOutlineMat, hullOf, noRaycast } from './toon.js';

const SUPPORT_URL = 'https://buymeacoffee.com/schlunsen';
const TEXT = 'Enjoying Gitilla?  Buy me a coffee ☕';
// Real seconds, not frame steps: a flypast takes the same time however fast the page renders.
const CROSS = 22;                           // seconds to cross the view
const REST_MIN = 16, REST_VAR = 18;         // seconds out of sight between passes
const AHEAD = 72, HALF = 130;               // how far in front of the camera it crosses, and half the run
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

// A cartoon prop plane in the island's toon style. Local frame: +x is the nose, y up.
function buildPlaneModel() {
  const g = new THREE.Group();
  const teal = toonMat({ color: 0x64dedb }), cream = toonMat({ color: 0xf6f1e4 }), dark = toonMat({ color: 0x2f3542 });
  const yellow = toonMat({ color: 0xf2c14e }), glass = toonMat({ color: 0x9ad3ea });
  const pickables = [];
  const add = (geo, mat, ink = 0.12) => {
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    pickables.push(m);
    if (ink) { const h = new THREE.Mesh(hullOf(geo, ink), getOutlineMat()); h.raycast = noRaycast; g.add(h); }
    return m;
  };
  add(new THREE.CapsuleGeometry(0.55, 3.2, 6, 12).rotateZ(Math.PI / 2), teal, 0.14);                          // fuselage
  add(new THREE.BoxGeometry(1.3, 0.12, 6.6).translate(0.35, 0.12, 0), cream, 0.12);                             // wing
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
  const front = new THREE.Mesh(new THREE.PlaneGeometry(BANNER_W, BANNER_H, SEGS, 1), mat);
  // A second face for the other side. Turning it round already reverses it for a
  // viewer over there, so its uvs stay as they are: mirroring them too would
  // flip the text back and it would read backwards from that side.
  const backGeo = new THREE.PlaneGeometry(BANNER_W, BANNER_H, SEGS, 1);
  const back = new THREE.Mesh(backGeo, mat);
  back.rotation.y = Math.PI;
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
  rig = { plane, prop, banner, front, back, rope, pickables: [...pickables, front, back], start: 0, flying: false, next: now() + FIRST_WAIT, side: 1, cross: CROSS, from: new THREE.Vector3(), to: new THREE.Vector3() };
  updateBannerPlane(0, 0, false);
}

const _p = new THREE.Vector3(), _b = new THREE.Vector3(), _tail = new THREE.Vector3(), _lead = new THREE.Vector3(), _dir = new THREE.Vector3();
const _f = new THREE.Vector3(), _side = new THREE.Vector3(), _mid = new THREE.Vector3(), _dirXZ = new THREE.Vector3();
const _vf = new THREE.Vector3(), _vs = new THREE.Vector3(), _vc = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
// Flutter: a travelling wave that grows toward the free end of the banner.
function flutter(mesh, time, sign) {
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), u = (BANNER_W / 2 - sign * x) / BANNER_W; // 0 at the rope end, 1 at the free end
    pos.setZ(i, Math.sin(u * 9 - time * 7) * 0.45 * u * sign);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

// A pass: a straight run across the view, planned from where the camera looks now.
function planPass() {
  _f.set(controls.target.x - camera.position.x, 0, controls.target.z - camera.position.z);
  if (_f.lengthSq() < 1e-4) _f.set(0, 0, -1);
  _f.normalize();
  _side.set(-_f.z, 0, _f.x).multiplyScalar(rig.side); // across the view, alternating each time
  // Cross whatever you are looking at: usually straight over the city, sometimes just past it.
  const reach = Math.hypot(controls.target.x - camera.position.x, controls.target.z - camera.position.z) || AHEAD;
  const d = Math.min(180, Math.max(30, reach * (0.6 + Math.random() * 0.75)));
  const y = Math.min(80, Math.max(44, camera.position.y * 0.42 + 10)); // over the rooftops, under the clouds
  _mid.set(camera.position.x + _f.x * d, y, camera.position.z + _f.z * d);
  rig.from.copy(_mid).addScaledVector(_side, -HALF);
  rig.to.copy(_mid).addScaledVector(_side, HALF);
  rig.start = now();
  rig.cross = CROSS; // a click can lengthen this pass
  rig.flying = true;
  rig.side = -rig.side;
}

export function updateBannerPlane(dt, elapsed, hidden) {
  if (!rig) return;
  if (hidden) { rig.plane.visible = rig.banner.visible = rig.rope.visible = false; return; }
  if (!rig.flying) { // out of sight between passes
    rig.plane.visible = rig.banner.visible = rig.rope.visible = false;
    if (now() < rig.next) return;
    planPass();
  }
  const age = now() - rig.start, u = age / rig.cross;
  if (u >= 1) { // gone by: rest, then come back the other way
    rig.flying = false;
    rig.next = now() + REST_MIN + Math.random() * REST_VAR;
    rig.plane.visible = rig.banner.visible = rig.rope.visible = false;
    return;
  }
  rig.plane.visible = rig.banner.visible = rig.rope.visible = true;
  const bob = Math.sin(age * 0.7) * 0.9;
  _p.lerpVectors(rig.from, rig.to, u);
  _p.y += bob;
  rig.plane.position.copy(_p);
  _dirXZ.subVectors(rig.to, rig.from).setY(0).normalize();
  // Nose along the run. The model faces +x, and rotateY(a) sends +x to (cos a, 0, -sin a),
  // so the heading (dx, dz) needs a = atan2(-dz, dx).
  const yaw = Math.atan2(-_dirXZ.z, _dirXZ.x);
  rig.plane.rotation.set(0, 0, 0);
  rig.plane.rotateY(yaw);
  rig.plane.rotateZ(Math.sin(age * 0.5) * 0.05); // a lazy roll
  rig.prop.rotation.x += dt * 38;
  // The banner trails a tow line behind the tail, along the run.
  const lag = SCALE * 2.6 + GAP + BANNER_W / 2;
  _b.copy(_p).addScaledVector(_dirXZ, -lag);
  _b.y -= 2.2; // the tow line angles down to it
  rig.banner.position.copy(_b);
  rig.banner.rotation.set(0, yaw, 0);
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
export function bannerPlaneView(eye, look) {
  if (!rig || !rig.flying) return false;
  rig.banner.updateMatrixWorld();
  look.setFromMatrixPosition(rig.banner.matrixWorld);
  _vf.set(1, 0, 0).applyQuaternion(rig.banner.quaternion); // along the run
  _vs.set(-_vf.z, 0, _vf.x);
  if (_vs.dot(_vc.subVectors(camera.position, look)) < 0) _vs.negate(); // stay on the side you are already on
  eye.copy(look).addScaledVector(_vs, VIEW_SIDE).addScaledVector(_vf, -VIEW_BACK);
  eye.y = look.y + VIEW_UP;
  return true;
}

// Clicking the plane: leave enough of the pass to read the banner during the flight over.
export function holdBannerPass(sec = 12) {
  if (!rig || !rig.flying) return false;
  rig.cross = Math.max(rig.cross, (now() - rig.start) + sec);
  return true;
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
