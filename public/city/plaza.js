import * as THREE from 'three';
import { renderer, clock, cityGroup } from './scene.js';
import { toonMat, getOutlineMat, noRaycast, TAU, box, hullOf, mergeParts, annulusGeo, envMat, seededRandom, roundRect, makeGlowTexture } from './toon.js';
import { PLAZA_R } from './layout.js';
import { ACCENT } from './constants.js';

// ---------------------------------------------------------------------------
// Central plaza: a designed town square. Painted radial paving with compass
// walkways, a contribution track under the heatmap ring, a teal inlay, an
// inked kerb, tree planters, benches and lanterns on the rim, and a monument
// (octagonal steps rising out of the fountain pool, a plinth with the Git
// emblem, a tapered commit-history pillar, a floating glowing diamond). The
// avatar hovers above the diamond. Built once; nothing here is pickable.
// ---------------------------------------------------------------------------
export const PLAZA_Y = 0.14;                                  // paving surface height
export const POOL = { water: 3.9, rimIn: 6.5, rimOut: 7.2 };  // fountain pool radii
export let plazaFx = null; // { finial, finialY, setGlow(glow) }

export function buildPlaza() {
  const add = (mesh, cast = false, receive = false) => {
    mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.raycast = noRaycast;
    cityGroup.add(mesh);
    return mesh;
  };
  // Base disc hides the street grid under the square; the paving is painted on top.
  add(new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R, PLAZA_R, 0.12, 64), envMat(0x1f2837, 0xe6dcc6)), false, true).position.y = 0.06;
  const { map, glowMap } = paintPlazaPaving();
  const paveMat = envMat(0x5a6680, 0xffffff, { map, emissive: 0xffffff, emissiveMap: glowMap, emissiveIntensity: 0.1 });
  add(new THREE.Mesh(new THREE.CircleGeometry(PLAZA_R, 96).rotateX(-Math.PI / 2), paveMat), false, true).position.y = PLAZA_Y;
  // Raised, inked kerb so the square reads as one designed shape.
  add(new THREE.Mesh(annulusGeo(PLAZA_R - 0.05, PLAZA_R + 0.4, 0.26, 48), envMat(0x141a26, 0xb3a489)), false, true);
  add(new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R + 0.5, PLAZA_R + 0.5, 0.36, 96, 1, true), getOutlineMat())).position.y = 0.13;

  // Static parts are merged: vertex-coloured stone, ink hulls, teal glow, lanterns.
  const stone = [], hull = [], teal = [], lanterns = [], pools = [];
  const part = (g, hex, t = 0, m = null) => {
    if (t) hull.push(m ? hullOf(g, t).applyMatrix4(m) : hullOf(g, t));
    stone.push([m ? g.applyMatrix4(m) : g, hex]);
  };
  const STONE = 0xe9dfc9, STONE_2 = 0xd8cbad, STONE_3 = 0xc4b594, SLATE = 0x7483a6, SLATE_2 = 0x5b6788;

  // --- Monument: octagonal steps out of the pool, plinth, pillar, diamond.
  let y = PLAZA_Y;
  for (const [r, h, c] of [[4.5, 0.55, STONE_2], [3.6, 0.45, STONE], [2.75, 0.4, STONE_2]]) {
    part(new THREE.CylinderGeometry(r, r, h, 8).rotateY(Math.PI / 8).translate(0, y + h / 2, 0), c, 0.2);
    y += h;
  }
  part(box(3.1, 0.3, 3.1, 0, y + 0.15, 0), STONE_3, 0.16);   // base moulding
  part(box(2.7, 2.2, 2.7, 0, y + 1.4, 0), STONE, 0.2);        // die
  part(box(3.2, 0.32, 3.2, 0, y + 2.66, 0), STONE_3, 0.16);   // cornice
  const plinthMid = y + 1.4;
  y += 2.82;
  const sh = 7.6, bw = 0.9, tw = 0.62, shaftY = y, hw = yy => bw - (bw - tw) * (yy - shaftY) / sh;
  part(box(2.0, 0.32, 2.0, 0, y + 0.16, 0), SLATE_2, 0.16);   // collar
  part(new THREE.CylinderGeometry(tw * Math.SQRT2, bw * Math.SQRT2, sh, 4).rotateY(Math.PI / 4).translate(0, y + sh / 2, 0), SLATE, 0.22);
  // Commit history up each face of the pillar: a glowing line with four commits.
  const tilt = Math.atan((bw - tw) / sh), lineMid = y + sh * 0.5;
  for (let f = 0; f < 4; f++) {
    const rot = new THREE.Matrix4().makeRotationY(f * Math.PI / 2);
    teal.push(box(0.06, sh * 0.8, 0.08).rotateZ(tilt).translate(hw(lineMid) + 0.015, lineMid, 0).applyMatrix4(rot));
    for (let k = 0; k < 4; k++) {
      const yy = y + sh * (0.17 + k * 0.22);
      teal.push(box(0.08, 0.3, 0.3, hw(yy) + 0.02, yy, 0).applyMatrix4(rot));
    }
  }
  y += sh;
  part(box(1.75, 0.3, 1.75, 0, y + 0.15, 0), STONE, 0.16);   // capital
  y += 0.3;
  const cap = new THREE.ConeGeometry(0.8 * Math.SQRT2, 1.2, 4).rotateY(Math.PI / 4).translate(0, y + 0.6, 0);
  hull.push(hullOf(cap, 0.16));
  teal.push(cap);
  const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.72), toonMat({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.6 }));
  const finialHull = new THREE.Mesh(new THREE.OctahedronGeometry(0.83), getOutlineMat());
  finialHull.raycast = noRaycast;
  finial.add(finialHull);
  finial.scale.set(1, 1.35, 1); // a tall Git-ish diamond
  const finialY = y + 1.2 + 1.3;
  add(finial, true).position.y = finialY;
  cityGroup.userData.beacon = finial;
  // Git emblem on the four faces of the plinth.
  const emblem = paintGitEmblem();
  const emblemMat = toonMat({ map: emblem, emissive: 0xffffff, emissiveMap: emblem, emissiveIntensity: 0.15, alphaTest: 0.5 });
  const plates = [];
  for (let f = 0; f < 4; f++) plates.push(new THREE.PlaneGeometry(1.9, 1.9).translate(0, 0, 1.365).rotateY(f * Math.PI / 2).translate(0, plinthMid, 0));
  add(new THREE.Mesh(mergeParts(plates), emblemMat));
  // Four stone footbridges cross the pool from the walkways to the steps.
  for (let f = 0; f < 4; f++) {
    const rot = new THREE.Matrix4().makeRotationY(f * Math.PI / 2);
    part(box(2.9, 0.16, 1.3, 5.4, PLAZA_Y + 0.47, 0), STONE_3, 0.12, rot);
    for (const s of [-1, 1]) part(box(2.9, 0.16, 0.1, 5.4, PLAZA_Y + 0.63, s * 0.6), STONE_2, 0, rot);
  }

  // --- Rim furniture: tree planters on the diagonals, benches facing the
  // monument, lanterns flanking the four walkways.
  const at = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
  for (let q = 0; q < 4; q++) {
    const a = Math.PI / 4 + q * Math.PI / 2, [px, pz] = at(13.8, a);
    part(new THREE.CylinderGeometry(1.05, 0.9, 0.7, 8).translate(px, PLAZA_Y + 0.35, pz), STONE_3, 0.16);
    part(new THREE.CylinderGeometry(0.94, 0.94, 0.06, 8).translate(px, PLAZA_Y + 0.68, pz), 0x5b4330);
    part(new THREE.CylinderGeometry(0.11, 0.16, 1.4, 6).translate(px, PLAZA_Y + 1.35, pz), 0x7a5236);
    part(new THREE.IcosahedronGeometry(1.2, 1).translate(px, PLAZA_Y + 2.65, pz), 0x5fb35a, 0.18);
    const [ox, oz] = at(0.55, a + 2.2);
    part(new THREE.IcosahedronGeometry(0.72, 1).translate(px + ox, PLAZA_Y + 2.2, pz + oz), 0x7fc96b, 0.14);
  }
  for (const { b, x: bx, z: bz } of plazaBenchSpots()) {
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2 - b).setPosition(bx, PLAZA_Y, bz);
    part(box(1.5, 0.1, 0.46, 0, 0.44, 0), 0xd08b54, 0.1, m);        // seat
    part(box(1.5, 0.34, 0.08, 0, 0.78, 0.22), 0xd08b54, 0.1, m);    // backrest (outward)
    for (const lx of [-0.58, 0.58]) part(box(0.1, 0.42, 0.42, lx, 0.21, 0.02), 0x3a4152, 0, m);
  }
  for (let q = 0; q < 4; q++) for (const s of [-1, 1]) {
    const [lx, lz] = at(14.55, q * Math.PI / 2 + s * 0.2);
    part(box(0.36, 0.26, 0.36, lx, PLAZA_Y + 0.13, lz), 0x2a2f3a);
    part(new THREE.CylinderGeometry(0.07, 0.09, 3.0, 6).translate(lx, PLAZA_Y + 1.6, lz), 0x2a2f3a);
    part(new THREE.ConeGeometry(0.34, 0.3, 4).rotateY(Math.PI / 4).translate(lx, PLAZA_Y + 3.67, lz), 0x2a2f3a);
    const lantern = box(0.36, 0.44, 0.36, lx, PLAZA_Y + 3.3, lz);
    hull.push(hullOf(lantern, 0.12));
    lanterns.push(lantern);
    pools.push(new THREE.CircleGeometry(2.8, 24).rotateX(-Math.PI / 2).translate(lx, PLAZA_Y + 0.03, lz));
  }

  add(new THREE.Mesh(mergeParts(stone, true), envMat(0x76829f, 0xffffff, { vertexColors: true })), true, true);
  add(new THREE.Mesh(mergeParts(hull), getOutlineMat()));
  const tealMat = toonMat({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.3 });
  add(new THREE.Mesh(mergeParts(teal), tealMat), true);
  const lanternMat = toonMat({ color: 0xfff1c9, emissive: 0xffd58a, emissiveIntensity: 0.1 });
  add(new THREE.Mesh(mergeParts(lanterns), lanternMat));
  const poolMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(64), color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  add(new THREE.Mesh(mergeParts(pools), poolMat));

  plazaFx = {
    finial, finialY,
    setGlow(glow) {
      tealMat.emissiveIntensity = 0.3 + glow * 1.1;
      emblemMat.emissiveIntensity = 0.15 + glow * 0.9;
      lanternMat.emissiveIntensity = 0.1 + glow * 2.2;
      paveMat.emissiveIntensity = 0.1 + glow * 0.9;
      poolMat.opacity = glow * 0.7;
      poolMat.visible = glow > 0.02;
    },
    setAccent(hex) { // city.json look.accent; null brings back the house teal
      const c = hex ?? ACCENT;
      tealMat.color.setHex(c); tealMat.emissive.setHex(c);
      finial.material.color.setHex(c); finial.material.emissive.setHex(c);
    },
  };
}

// Top-down paving for the square, plus a matching emissive mask for the teal
// inlays. Canvas angles match world atan2(z, x).
function paintPlazaPaving() {
  const S = 1024, c = S / 2, k = c / PLAZA_R;
  const canvas = () => { const cv = document.createElement('canvas'); cv.width = cv.height = S; return cv; };
  const cv = canvas(), gv = canvas(), x = cv.getContext('2d'), gx = gv.getContext('2d');
  const rnd = seededRandom(1234);
  const ring = (ctx, r0, r1, fill) => {
    ctx.beginPath(); ctx.arc(c, c, r1 * k, 0, TAU); ctx.arc(c, c, r0 * k, 0, TAU, true);
    ctx.fillStyle = fill; ctx.fill();
  };
  const line = (ctx, r, w, stroke) => {
    ctx.beginPath(); ctx.arc(c, c, r * k, 0, TAU); ctx.lineWidth = w * k; ctx.strokeStyle = stroke; ctx.stroke();
  };
  // A course of radial pavers: n stones, alternating tones with a little noise.
  const course = (r0, r1, n, off, tones) => {
    for (let i = 0; i < n; i++) {
      const a0 = off + (i / n) * TAU, a1 = a0 + TAU / n;
      x.beginPath(); x.arc(c, c, r1 * k, a0, a1); x.arc(c, c, r0 * k, a1, a0, true); x.closePath();
      x.fillStyle = tones[(i + (rnd() < 0.18 ? 1 : 0)) % tones.length]; x.fill();
      x.lineWidth = 1.6; x.strokeStyle = 'rgba(120,100,70,0.45)'; x.stroke();
    }
  };
  x.fillStyle = '#e9dfca'; x.fillRect(0, 0, S, S);
  gx.fillStyle = '#000'; gx.fillRect(0, 0, S, S);
  // Pool floor (seen through the water) with two tile rings.
  ring(x, 0, POOL.rimOut, '#2c7392');
  line(x, 5.0, 0.05, '#4a9bb8'); line(x, 5.8, 0.05, '#4a9bb8');
  const light = ['#efe6d3', '#e5d9c1', '#eadfca'], warm = ['#ded1b7', '#d4c6aa'];
  course(7.2, 7.95, 36, 0, ['#d2c3a3', '#c9b998']);
  course(7.95, 9.1, 44, 0, light);
  course(9.1, 10.3, 52, TAU / 104, light);
  course(11.7, 13.0, 64, 0, light);
  course(13.24, 14.25, 72, 0, warm);
  course(14.25, PLAZA_R, 80, TAU / 160, warm);
  // Walkways at the four compass points, laid in a small square grid.
  for (let q = 0; q < 4; q++) {
    x.save(); x.translate(c, c); x.rotate(q * Math.PI / 2);
    const w0 = POOL.rimOut * k, w1 = PLAZA_R * k, hw = 1.2 * k;
    x.fillStyle = '#f5eee0'; x.fillRect(w0, -hw, w1 - w0, hw * 2);
    x.strokeStyle = 'rgba(150,130,95,0.35)'; x.lineWidth = 1.2;
    for (let p = w0; p < w1; p += 0.6 * k) { x.beginPath(); x.moveTo(p, -hw); x.lineTo(p, hw); x.stroke(); }
    for (let p = -hw; p <= hw + 0.1; p += 0.6 * k) { x.beginPath(); x.moveTo(w0, p); x.lineTo(w1, p); x.stroke(); }
    x.strokeStyle = '#b5a68a'; x.lineWidth = 0.08 * k;
    for (const e of [-hw, hw]) { x.beginPath(); x.moveTo(w0, e); x.lineTo(w1, e); x.stroke(); }
    x.restore();
  }
  // Planter footprints on the diagonals.
  for (let q = 0; q < 4; q++) {
    const a = Math.PI / 4 + q * Math.PI / 2;
    x.beginPath(); x.arc(c + Math.cos(a) * 13.8 * k, c + Math.sin(a) * 13.8 * k, 1.45 * k, 0, TAU);
    x.fillStyle = '#cdbf9e'; x.fill(); x.lineWidth = 0.06 * k; x.strokeStyle = '#ad9e80'; x.stroke();
  }
  // Contribution track under the heatmap ring, edged with glowing teal.
  ring(x, 10.3, 11.7, '#bdb096');
  for (const r of [10.33, 11.67]) { line(x, r, 0.07, '#64dedb'); line(gx, r, 0.07, '#64dedb'); }
  // Teal inlay ring (glows at night), inked on both edges.
  ring(x, 13.0, 13.24, '#64dedb'); ring(gx, 13.0, 13.24, '#64dedb');
  line(x, 13.0, 0.035, '#27323f'); line(x, 13.24, 0.035, '#27323f');
  ring(x, PLAZA_R - 0.14, PLAZA_R, '#a39679'); // kerb-side border
  const tex = cvs => {
    const t = new THREE.CanvasTexture(cvs);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  return { map: tex(cv), glowMap: tex(gv) };
}

// Teal Git-style diamond with a branch glyph (trunk, side branch, three commits).
function paintGitEmblem() {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.translate(S / 2, S / 2);
  x.save(); x.rotate(Math.PI / 4);
  roundRect(x, -80, -80, 160, 160, 30);
  x.fillStyle = '#64dedb'; x.fill();
  x.lineWidth = 12; x.strokeStyle = '#0a0d16'; x.stroke();
  x.restore();
  x.strokeStyle = x.fillStyle = '#12363b';
  x.lineWidth = 14; x.lineCap = 'round';
  x.beginPath(); x.moveTo(-22, 50); x.lineTo(-22, -50); x.stroke();
  x.beginPath(); x.moveTo(-22, 24); x.quadraticCurveTo(30, 20, 30, -22); x.stroke();
  for (const [px, py] of [[-22, 50], [-22, -50], [30, -22]]) { x.beginPath(); x.arc(px, py, 15, 0, TAU); x.fill(); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function updatePlaza(dt) {
  if (!plazaFx) return;
  plazaFx.finial.rotation.y += dt * 0.9;
  plazaFx.finial.position.y = plazaFx.finialY + Math.sin(clock.getElapsed() * 1.6) * 0.16;
}

// Benches on the plaza rim, two per tree planter, facing the monument (shared
// by buildPlaza and the people sitting on them). b = angle around the plaza.
export function plazaBenchSpots() {
  const spots = [];
  for (let q = 0; q < 4; q++) for (const s of [-1, 1]) {
    const b = Math.PI / 4 + q * Math.PI / 2 + s * 0.19;
    spots.push({ b, x: Math.cos(b) * 13.8, z: Math.sin(b) * 13.8 });
  }
  return spots;
}
