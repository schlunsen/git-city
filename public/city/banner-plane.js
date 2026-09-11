/*
 * Git City — the sponsor plane: a little prop plane circles the town towing a
 * banner that nudges visitors to support Git City on Buy Me a Coffee. Clicking
 * the plane or its banner opens the Buy Me a Coffee widget (loaded by
 * index.html); without the widget, the page opens in a new tab.
 */
import * as THREE from 'three';
import { scene } from './scene.js';
import { toonMat, getOutlineMat, hullOf, noRaycast } from './toon.js';

const SUPPORT_URL = 'https://buymeacoffee.com/schlunsen';
const TEXT = 'Enjoying Git City?  Buy me a coffee ☕';
const R = 108, Y = 46, LAP = 75;            // flight circle radius, height, seconds per lap
const SCALE = 1.5;                          // the plane model is ~5 units long before scaling
const BANNER_W = 22, BANNER_H = 2.9, SEGS = 28, GAP = 7; // banner size, cloth segments, tow-rope length

let rig = null; // { plane, prop, banner, front, back, rope, pickables, t }

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
  // The back face carries mirrored uvs, so the text reads the right way round from both sides.
  const backGeo = new THREE.PlaneGeometry(BANNER_W, BANNER_H, SEGS, 1);
  const uv = backGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const back = new THREE.Mesh(backGeo, mat);
  back.rotation.y = Math.PI;
  const banner = new THREE.Group();
  banner.add(front, back);
  const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x2f3542 }));
  rope.frustumCulled = false;
  rope.raycast = noRaycast;
  scene.add(plane, banner, rope);
  rig = { plane, prop, banner, front, back, rope, pickables: [...pickables, front, back], t: Math.random() * LAP };
  updateBannerPlane(0, 0, false);
}

const _p = new THREE.Vector3(), _b = new THREE.Vector3(), _tail = new THREE.Vector3();
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

export function updateBannerPlane(dt, elapsed, hidden) {
  if (!rig) return;
  rig.plane.visible = rig.banner.visible = rig.rope.visible = !hidden;
  if (hidden) return;
  rig.t += dt;
  const th = (rig.t / LAP) * Math.PI * 2;
  const bob = Math.sin(rig.t * 0.6) * 1.5;
  _p.set(Math.cos(th) * R, Y + bob, Math.sin(th) * R);
  rig.plane.position.copy(_p);
  rig.plane.rotation.set(0, 0, 0);
  rig.plane.rotateY(-(th + Math.PI / 2)); // nose along the direction of travel (counter-clockwise from above)
  rig.plane.rotateX(-0.22);               // bank into the turn
  rig.prop.rotation.x += dt * 38;
  // The banner trails GAP units of rope behind the tail, tangent to the circle at its own centre.
  const lag = (SCALE * 2.6 + GAP + BANNER_W / 2) / R;
  const tb = th - lag;
  _b.set(Math.cos(tb) * R, Y + bob - 1.2, Math.sin(tb) * R);
  rig.banner.position.copy(_b);
  rig.banner.rotation.set(0, -(tb + Math.PI / 2), 0);
  flutter(rig.front, rig.t, 1);
  flutter(rig.back, rig.t, -1);
  // Rope from the plane's tail to the banner's leading edge.
  _tail.set(-2.4, 0, 0).applyMatrix4(rig.plane.matrixWorld);
  rig.plane.updateMatrixWorld();
  const lead = new THREE.Vector3(BANNER_W / 2, 0, 0).applyMatrix4(rig.banner.updateMatrixWorld() || rig.banner.matrixWorld);
  const rp = rig.rope.geometry.attributes.position;
  rp.setXYZ(0, _tail.x, _tail.y, _tail.z);
  rp.setXYZ(1, lead.x, lead.y, lead.z);
  rp.needsUpdate = true;
}

// Is the pointer ray on the plane or its banner?
export function bannerPlaneHit(raycaster) {
  return !!rig && rig.plane.visible && raycaster.intersectObjects(rig.pickables, false).length > 0;
}

// Open the Buy Me a Coffee widget (index.html loads it); the page itself if it's unavailable.
export function openSupport() {
  const btn = document.getElementById('bmc-wbtn');
  if (btn) { btn.click(); return; }
  window.open(SUPPORT_URL, '_blank', 'noopener');
}
