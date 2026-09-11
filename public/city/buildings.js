/*
 * Repo buildings: tiered towers with painted facades, roofs and rooftop props,
 * plus the building-config extras (roof, graffiti, flag). Owns the list of
 * buildings on screen and the full_name -> building index.
 */
import * as THREE from 'three';
import { cityGroup, world } from './scene.js';
import { toonMat, getOutlineMat, outlineBox, noRaycast, hashStr, seededRandom } from './toon.js';
import { buildingPalette, WIN_STYLES, paintFacade } from './facade.js';
import { hexNum, disposeObject } from './util.js';
import { paintGraffiti } from '../graffiti.js'; // spray-painted wall text (building configs)

export let buildingMeshes = [];   // { mesh, body, bodies, bodyMat, bodyMats, roofMat, hull, beacon, repo, h, ... }
export const buildingByName = new Map(); // repo full_name -> building

// Take every building down (a new city, or a rebuild for a config change).
export function resetBuildings() {
  for (const b of buildingMeshes) {
    cityGroup.remove(b.mesh);
    disposeObject(b.mesh);
  }
  buildingMeshes = [];
  buildingByName.clear();
}

export function createBuilding(repo, x, z, h, f, color, bcfg = null) { // bcfg: building config (city.json repos[name] + building.json)
  const form = bcfg?.style;
  const group = new THREE.Group();
  const rnd = seededRandom(hashStr(repo.full_name || repo.name || ''));
  const pal = buildingPalette(color);
  const style = WIN_STYLES[Math.floor(rnd() * WIN_STYLES.length)];
  const litProb = 0.45 + rnd() * 0.4;

  // Silhouette: tall towers step back in tiers; small ones may get a hip roof.
  let tiers;
  if (h >= 28 && rnd() > 0.3) tiers = [{ h: h * 0.46, f }, { h: h * 0.32, f: f * 0.8 }, { h: h * 0.22, f: f * 0.62 }];
  else if (h >= 15 && rnd() > 0.35) tiers = [{ h: h * 0.6, f }, { h: h * 0.4, f: f * 0.74 }];
  else tiers = [{ h, f }];
  let hip = tiers.length === 1 && h < 9 && rnd() > 0.45;
  // city.json style changes the silhouette only (height and footprint still follow
  // the stars); applied after the draws above so the rest of the building is unchanged.
  if (form === 'tower') { tiers = [{ h, f }]; hip = false; } // one shaft; the spire goes on below
  else if (form === 'stepped') { tiers = h >= 8 ? [{ h: h * 0.5, f }, { h: h * 0.3, f: f * 0.78 }, { h: h * 0.2, f: f * 0.6 }] : [{ h: h * 0.62, f }, { h: h * 0.38, f: f * 0.72 }]; hip = false; }
  else if (form === 'cottage') { tiers = [{ h, f }]; hip = true; }
  else if (form === 'block') { tiers = [{ h, f }]; hip = false; }
  const neon = bcfg?.neon ? hexNum(bcfg.neon) : 0xffffff; // building config "neon": the lit windows' glow

  const roofH = 0.7, over = 0.45;
  const roofMat = toonMat({ color: pal.roof });
  const propMat = toonMat({ color: 0xdfe3ec });
  const propDark = toonMat({ color: 0x3a4152 });
  const bodies = [], bodyMats = [], hulls = [];
  let baseY = 0, topY = 0, topF = f, cx = 0, cz = 0;
  tiers.forEach((t, i) => {
    const tf = Math.max(2.2, t.f);
    if (i > 0) {
      // Upper tiers sit slightly off-centre so towers aren't perfectly symmetric.
      const slack = (Math.max(2.2, tiers[i - 1].f) - tf) / 2 * 0.7;
      cx += (rnd() - 0.5) * 2 * slack; cz += (rnd() - 0.5) * 2 * slack;
    }
    const { map, emissiveMap } = paintFacade(rnd, pal, tf, t.h, { ground: i === 0, style, litProb });
    const mat = toonMat({ color: 0xffffff, map, emissive: neon, emissiveMap, emissiveIntensity: 0 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(tf, t.h, tf), mat);
    body.position.set(cx, baseY + t.h / 2, cz);
    body.castShadow = body.receiveShadow = true;
    group.add(body); bodies.push(body); bodyMats.push(mat);
    const o = i === 0 ? over : over * 0.6;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(tf + o, roofH, tf + o), roofMat);
    cap.position.set(cx, baseY + t.h + roofH / 2, cz);
    cap.castShadow = true;
    group.add(cap);
    const hull = outlineBox(tf + o, t.h + roofH, tf + o, 0.34);
    hull.position.set(cx, baseY + (t.h + roofH) / 2, cz);
    group.add(hull); hulls.push(hull);
    baseY += t.h + roofH; topY = baseY; topF = tf;
  });

  if (hip) {
    const r = (topF + over) * 0.72;
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(r, 1.9, 4), roofMat);
    pyr.rotation.y = Math.PI / 4; pyr.position.set(cx, topY + 0.95, cz); pyr.castShadow = true;
    const pyrHull = new THREE.Mesh(new THREE.ConeGeometry(r + 0.3, 2.2, 4), getOutlineMat());
    pyrHull.raycast = () => {}; pyrHull.rotation.y = Math.PI / 4; pyrHull.position.set(cx, topY + 0.95, cz);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 0.5), toonMat({ color: 0x8a5a48 }));
    chimney.position.set(cx + topF * 0.25, topY + 1.1, cz - topF * 0.2);
    group.add(pyr, pyrHull, chimney);
  } else if (bcfg?.roof) { // building config "roof" replaces the random decal / props
    buildRoof(group, bcfg.roof, { cx, cz, topY, topF, size: topF + (tiers.length === 1 ? over : over * 0.6), propDark });
  } else {
    // Half the flat roofs get a painted top-down decal (helipad, garden,
    // gravel + HVAC, solar); the rest keep their 3D props.
    const decalRoof = !!world && topF >= 3.2 && rnd() < 0.5;
    if (decalRoof) {
      const d = world.roofDecal(Math.floor(rnd() * 4), topF + (tiers.length === 1 ? over : over * 0.6) - 0.5);
      d.position.set(cx, topY + 0.02, cz);
      group.add(d);
    }
    // Rooftop props: water towers on wide roofs, AC boxes, a mast on tall ones.
    if (!decalRoof && topF >= 5 && rnd() > 0.35) {
      const tower = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 1.3, 4, 1, true), propDark);
      legs.position.y = 0.65;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.8, 10), toonMat({ color: 0xc98a5a }));
      tank.position.y = 2.2;
      const lid = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 10), propDark);
      lid.position.y = 3.5;
      const tankHull = new THREE.Mesh(new THREE.CylinderGeometry(1.24, 1.24, 2.15, 10), getOutlineMat());
      tankHull.raycast = () => {};
      tankHull.position.y = 2.2;
      tower.add(legs, tank, lid, tankHull);
      tower.position.set(cx + (rnd() - 0.5) * (topF - 3.4), topY, cz + (rnd() - 0.5) * (topF - 3.4));
      group.add(tower);
    }
    const acCount = !decalRoof && topF >= 3.6 ? 1 + Math.floor(rnd() * 2) : 0;
    for (let i = 0; i < acCount; i++) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.1), propMat);
      ac.position.set(cx + (rnd() - 0.5) * (topF - 2.4), topY + 0.35, cz + (rnd() - 0.5) * (topF - 2.4));
      ac.add(outlineBox(1.1, 0.7, 1.1, 0.16));
      group.add(ac);
    }
    if (tiers.length === 3 || form === 'tower') {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.4, 6), propMat);
      spire.position.set(cx, topY + 1.7, cz);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.6, 4), propDark);
      ant.position.set(cx, topY + 4.6, cz);
      group.add(spire, ant);
    } else if (h > 12 && rnd() > 0.4) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 2.8, 5), propDark);
      mast.position.set(cx - topF / 2 + 0.9, topY + 1.4, cz + topF / 2 - 0.9);
      group.add(mast);
    }
  }

  // Building config "graffiti" (ground-floor walls) and "flag" (roof, or the cottage's ridge).
  if (bcfg?.graffiti) addGraffiti(group, bcfg.graffiti, { half: Math.max(2.2, tiers[0].f) / 2, height: tiers[0].h, x, z, seed: repo.full_name || repo.name || '' });
  if (bcfg?.flag) addRoofFlag(group, bcfg.flag, hip ? { x: cx, y: topY + 1.7, z: cz } : { x: cx - topF / 2 + 0.55, y: topY, z: cz + topF / 2 - 0.55 }, propDark);

  // Rooftop beacon for the most-starred repos (a glowing cap light).
  let beacon = null;
  if (repo.stargazers_count >= 100) {
    beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 10, 10),
      toonMat({ color: 0xffa03a, emissive: 0xff8a1a, emissiveIntensity: 1.4 }));
    beacon.position.set(cx + topF / 2 - 0.8, topY + (hip ? 2.1 : 0.4), cz - topF / 2 + 0.8);
    group.add(beacon);
  }

  group.position.set(x, 0, z);
  group.userData.repo = repo;
  cityGroup.add(group);

  const entry = {
    mesh: group, body: bodies[0], bodies, bodyMat: bodyMats[0], bodyMats, windowMat: bodyMats[0],
    roofMat, hull: hulls[0], beacon, repo, baseY: 0, h: topY, flicker: Math.random() * Math.PI * 2,
  };
  buildingMeshes.push(entry);
  // Every tier is a raycast target with a back-reference to the building.
  for (const b of bodies) b.userData.building = entry;
  if (repo.full_name) buildingByName.set(repo.full_name, entry);
}

// ---- building config extras (city.json repos[name] / a repo's building.json) ----
// "roof": one of world.js's painted roof decals, or a small prop.
const ROOF_DECAL = { helipad: 1, garden: 2, solar: 3 }; // roofs-0 is gravel + HVAC
function buildRoof(group, kind, { cx, cz, topY, topF, size, propDark }) {
  if (Object.hasOwn(ROOF_DECAL, kind)) {
    if (!world) return;
    const d = world.roofDecal(ROOF_DECAL[kind], size - 0.5);
    d.position.set(cx, topY + 0.02, cz);
    group.add(d);
  } else if (kind === 'pool') {
    const w = Math.max(1.2, topF - 1.3), d = Math.max(1, w * 0.62);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.12, d + 0.7), toonMat({ color: 0xe9dfc9 }));
    deck.position.set(cx, topY + 0.06, cz);
    const water = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), toonMat({ color: 0x4fc9ec, emissive: 0x2a9fd0, emissiveIntensity: 0.25 }));
    water.position.set(cx, topY + 0.17, cz);
    const kerb = toonMat({ color: 0xf6f1e6 });
    for (const [sx, sz, bw, bd] of [[0, 1, w + 0.3, 0.15], [0, -1, w + 0.3, 0.15], [1, 0, 0.15, d], [-1, 0, 0.15, d]]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.22, bd), kerb);
      k.position.set(cx + sx * (w / 2 + 0.075), topY + 0.23, cz + sz * (d / 2 + 0.075));
      group.add(k);
    }
    group.add(deck, water);
  } else if (kind === 'antenna') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 4.4, 6), propDark);
    mast.position.set(cx, topY + 2.2, cz);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), toonMat({ color: 0xdfe3ec, side: THREE.DoubleSide }));
    dish.rotation.x = -Math.PI / 2.4; dish.position.set(cx + 0.3, topY + 2.6, cz + 0.3);
    for (const y of [1.5, 3.1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), propDark);
      bar.position.set(cx, topY + y, cz);
      group.add(bar);
    }
    group.add(mast, dish);
  } // 'none': a bare roof
}
// "graffiti": spray paint (graffiti.js, canvas fillText only) on two ground-floor
// walls, below the shop fascia, on a decal just off the wall.
function addGraffiti(group, g, { half, height, x, z, seed }) {
  const fw = Math.min(half * 2 * 0.92, 5.2), fh = fw * (96 / 512);            // the fascia sign (repo-signs.js)
  const fasciaBottom = Math.min(height - 0.35 - fh / 2, 2.75) - fh / 2;
  const gh = Math.min(fasciaBottom - 0.3, half * 0.88), gw = gh * 2;          // the canvas is 2:1
  if (gh < 0.45) return;
  const tex = new THREE.CanvasTexture(paintGraffiti(document.createElement('canvas'), g, seed));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = toonMat({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // The wall facing away from the plaza, and the one beside it.
  let nx = x, nz = z;
  if (Math.abs(nx) > Math.abs(nz)) { nx = Math.sign(nx) || 1; nz = 0; } else { nz = Math.sign(nz) || 1; nx = 0; }
  for (const [ax, az] of [[nx, nz], [-nz, nx]]) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), mat);
    quad.rotation.y = Math.atan2(ax, az);
    quad.position.set(ax * (half + 0.04), 0.3 + gh / 2, az * (half + 0.04));
    quad.raycast = noRaycast;
    group.add(quad);
  }
}
// "flag": an emoji or up to 3 characters on a little rooftop flag.
function addRoofFlag(group, text, at, poleMat) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 6), poleMat);
  pole.position.set(at.x, at.y + 1.2, at.z);
  const c = document.createElement('canvas');
  c.width = 192; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fdf8ec'; g.fillRect(0, 0, 192, 128);
  g.lineWidth = 8; g.strokeStyle = '#1a2233'; g.strokeRect(4, 4, 184, 120);
  let px = 84;
  const font = () => `800 ${px}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  g.font = font();
  while (g.measureText(text).width > 168 && px > 24) { px -= 4; g.font = font(); }
  g.fillStyle = '#1a2233'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 96, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = toonMat({ map: tex });
  const cloth = new THREE.PlaneGeometry(1.2, 0.8).translate(0.6, 0, 0);
  const front = new THREE.Mesh(cloth, mat);
  const back = new THREE.Mesh(cloth.clone().rotateY(Math.PI).translate(1.2, 0, 0), mat); // reads the right way round from behind
  for (const m of [front, back]) { m.position.set(at.x + 0.05, at.y + 1.95, at.z); m.raycast = noRaycast; }
  pole.raycast = noRaycast;
  group.add(pole, front, back);
}
