/*
 * Per-profile overlays, rebuilt with every city: the contribution heatmap ring,
 * district name signs and baseplates, commit shuttles and fork beams.
 */
import * as THREE from 'three';
import { scene, clock } from './scene.js';
import { buildingMeshes } from './buildings.js';
import { cityLayout } from './block.js';
import { CELL, SIDEWALK, langMeta, starsToHeight, worldForCell } from './layout.js';
import { roundRect } from './toon.js';
import { disposeObject } from './util.js';
import { contributionDays, buildHeatmapRing } from '../city-enhancements.js';

let heatmapRing = null;    // InstancedMesh of contribution bricks
let commitShuttles = null; // { pts, data[] }
let forkBeams = null;      // { group, beams[] }
export let districtSigns = null; // { group }
let districtBaseplates = null;

// Remove enhancement meshes that are re-created per user (ring, shuttles,
// fork beams, district signs). Scene-level ones (sky, lamps, trees, fountain,
// pedestrians, clouds, weather) persist.
export function clearPerUserEnhancements() {
  for (const object of [heatmapRing, commitShuttles?.pts, forkBeams?.group, districtSigns?.group, districtBaseplates]) {
    if (object) { scene.remove(object); disposeObject(object); }
  }
  heatmapRing = commitShuttles = forkBeams = districtSigns = districtBaseplates = null;
}

export function buildRingFromEvents(events) {
  if (heatmapRing) { scene.remove(heatmapRing); disposeObject(heatmapRing); }
  heatmapRing = buildHeatmapRing(THREE, scene, contributionDays(events, 90), { radius: 11, brick: 0.72 }).mesh;
}

// A canvas-textured billboard sign for a district name.
function makeDistrictSign(THREE, label, colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  // Rounded translucent plate
  const r = 26;
  ctx.fillStyle = 'rgba(10,14,26,0.78)';
  roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, r);
  ctx.fill();
  ctx.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0');
  ctx.lineWidth = 6;
  roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, r);
  ctx.stroke();
  ctx.fillStyle = '#eaf0ff';
  ctx.font = '700 74px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 40);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.4), mat);
  mesh.userData.billboard = true;
  return mesh;
}

// Billboard district-name signs at the outer edge of each language quadrant,
// plus a tinted baseplate under each quadrant's footprint. Both are recreated
// per user (cleared by clearPerUserEnhancements).
export function buildDistrictSigns(THREE, assignments) {
  if (districtSigns) { scene.remove(districtSigns.group); }
  const group = new THREE.Group();
  const seen = new Map(); // language -> { gx, gz } of its outermost cell
  const tallest = new Map(); // language -> tallest building in the district
  for (const a of assignments) {
    const key = a.district;
    const prev = seen.get(key);
    tallest.set(key, Math.max(tallest.get(key) || 0, starsToHeight(a.repo?.stargazers_count || 0)));
    // track the cell furthest from plaza per language for sign placement
    if (!prev || cellDist(a.gx, a.gz) > cellDist(prev.gx, prev.gz)) seen.set(key, { gx: a.gx, gz: a.gz });
  }
  for (const [lang, cell] of seen) {
    const meta = langMeta(lang);
    const sign = makeDistrictSign(THREE, meta.name, meta.color);
    const pos = worldForCell(cell.gx, cell.gz);
    // Place the sign just outside the quadrant edge, facing the plaza.
    const dir = new THREE.Vector3(pos.x, 0, pos.z).normalize();
    // ...but never out past the boulevard, whatever the footprint's outline.
    let out = CELL * 0.8;
    while (out > 0 && cityLayout && cityLayout.dist(pos.x + dir.x * out, pos.z + dir.z * out) > SIDEWALK - 3) out -= 0.5;
    const edge = new THREE.Vector3(pos.x, 0, pos.z).add(dir.multiplyScalar(out));
    sign.position.set(edge.x, Math.max(13, (tallest.get(lang) || 0) * 1.08 + 5), edge.z);
    group.add(sign);
  }
  scene.add(group);
  districtSigns = { group };
}
function cellDist(gx, gz) { // cells are addressed from the plaza
  return Math.max(Math.abs(gx), Math.abs(gz));
}

export function buildDistrictBaseplates(THREE, assignments) {
  districtBaseplates = new THREE.Group();
  const geometry = new THREE.BoxGeometry(6.6, 0.16, 6.6);
  for (const a of assignments) {
    const material = new THREE.MeshLambertMaterial({ color: langMeta(a.district).color, transparent: true, opacity: 0.28 });
    const slab = new THREE.Mesh(geometry, material);
    const { x, z } = worldForCell(a.gx, a.gz);
    slab.position.set(x, 0.02, z);
    districtBaseplates.add(slab);
  }
  scene.add(districtBaseplates);
}

// Commit shuttles: small particles orbiting the tallest building.
export function buildCommitShuttles(repos, user) {
  if (commitShuttles) { scene.remove(commitShuttles.pts); commitShuttles = null; }
  const top = buildingMeshes[0];
  if (!top) return;
  const [tx, tz] = [top.mesh.position.x, top.mesh.position.z];
  const N = 26;
  const pos = new Float32Array(N * 3);
  const data = [];
  for (let i = 0; i < N; i++) {
    data.push({ a: Math.random()*Math.PI*2, r: 6 + Math.random()*6, y: top.h * (0.3 + Math.random()*0.7), sp: (0.4+Math.random()*0.6)*(Math.random()<0.5?1:-1) });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x64dedb, size: 0.35, transparent: true, opacity: 0.95 }));
  pts.position.set(tx, 0, tz);
  scene.add(pts);
  commitShuttles = { pts, geo, data, N, cy: top.h };
}

// Fork beams: light links from a forked building to its (nearest) parent.
export function buildForkBeams(repos) {
  if (forkBeams) { scene.remove(forkBeams.group); forkBeams = null; }
  const byName = new Map(buildingMeshes.map(b => [b.repo.full_name, b]));
  const group = new THREE.Group();
  const beams = [];
  const max = 40;
  let count = 0;
  for (const b of buildingMeshes) {
    if (count >= max) break;
    const repo = b.repo;
    if (!repo.fork || !repo.parent) continue;
    const parent = byName.get(repo.parent.full_name);
    if (!parent) continue;
    const a = new THREE.Vector3(b.mesh.position.x, b.h, b.mesh.position.z);
    const c = new THREE.Vector3(parent.mesh.position.x, parent.h, parent.mesh.position.z);
    const mid = a.clone().add(c).multiplyScalar(0.5).add(new THREE.Vector3(0, 4, 0));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, c);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)),
      new THREE.LineBasicMaterial({ color: 0x8c78ff, transparent: true, opacity: 0.5 }));
    group.add(line); beams.push(line); count++;
  }
  scene.add(group);
  forkBeams = { group, beams };
}

export function updateShuttles(dt) {
  if (!commitShuttles) return;
  const { geo, data, N } = commitShuttles;
  const pos = geo.attributes.position.array;
  for (let i = 0; i < N; i++) {
    const d = data[i];
    d.a += d.sp * dt;
    pos[i*3] = Math.cos(d.a) * d.r;
    pos[i*3+1] = d.y;
    pos[i*3+2] = Math.sin(d.a) * d.r;
  }
  geo.attributes.position.needsUpdate = true;
}
export function updateBeams(dt) {
  if (!forkBeams) return;
  const t = clock.getElapsed();
  for (const b of forkBeams.beams) b.material.opacity = 0.3 + Math.sin(t * 2) * 0.15;
}
