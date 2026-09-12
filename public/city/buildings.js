/*
 * Repo buildings: tiered towers with painted facades, roofs and rooftop props,
 * plus the building-config extras (roof, graffiti, flag). Owns the list of
 * buildings on screen and the full_name -> building index.
 */
import * as THREE from 'three';
import { cityGroup, world } from './scene.js';
import { toonMat, getOutlineMat, outlineBox, hullOf, noRaycast, hashStr, seededRandom } from './toon.js';
import { buildingPalette, paintFacade } from './facade.js';
import { ARCHITECTURES, architectureDetails } from './architecture.js';
import { skyscraperPlan } from './skyscrapers.js';
import { hexNum, disposeObject } from './util.js';
import { paintGraffiti } from '../graffiti.js'; // spray-painted wall text (building configs)

export let buildingMeshes = [];   // { mesh, body, bodies, bodyMat, bodyMats, roofMat, hull, beacon, repo, h, ... }
export const buildingByName = new Map(); // repo full_name -> building

// Take every building down (a new city, or a rebuild for a config change).
export function resetBuildings() {
  clearFocusState();
  for (const b of buildingMeshes) {
    cityGroup.remove(b.mesh);
    disposeObject(b.mesh);
  }
  buildingMeshes = [];
  buildingByName.clear();
}

// ---------------------------------------------------------------------------
// Tour focus: while the showcase tour circles one building, every other
// building fades to a dim ghost so the stop stands out. Building materials are
// per-building (toonMat never caches), so a fade is an opacity + colour target
// per material, eased toward by tickBuildingFocus each frame. The single
// shared outline material can't fade per building, so the focused building's
// hulls get a crisp full-opacity clone while the shared one fades with the city.
// ---------------------------------------------------------------------------
const FOCUS_DIM = 0.10;  // opacity of unfocused buildings while one has the focus
const FOCUS_DARK = 0.55; // …and a colour multiplier, so the ghosts don't wash out pale
const FOCUS_GLOW = 0.08; // …and a window-glow multiplier: lit panes drop to a faint ember
const FOCUS_EASE = 4.5;  // fade lerp rate (per second)
const faded = new Map(); // material -> { origOpacity, origTransparent, origDepthWrite, origColor, k, target }
let focusEntry = null, focusOutline = null, ghosting = false;

const eachMat = (root, fn) => root.traverse((o) => {
  if (!o.isMesh || !o.material) return;
  for (const m of Array.isArray(o.material) ? o.material : [o.material]) fn(m, o);
});

function fadeTo(m, target) {
  const f = faded.get(m);
  if (f) { f.target = target; return; }
  // Day/night-tinted materials are recoloured every frame by their own writer,
  // so a snapshot here would be stale: they dim via userData.focusK instead.
  const tinted = m.userData?.tinted;
  faded.set(m, { origOpacity: m.opacity, origTransparent: m.transparent, origDepthWrite: m.depthWrite,
                 origColor: tinted ? null : (m.color?.clone() || null), k: 1, target });
  if (target < m.opacity) {
    if (!m.transparent) { m.transparent = true; m.needsUpdate = true; } // recompile: opaque shaders force alpha to 1
    m.depthWrite = false;   // …and a ghost that writes depth still occludes like a solid box
  }
}

// Repo signs share atlas materials across buildings (repo-signs.js), so fading
// an unfocused building's board would fade the focused one's too. Instead the
// focused building's boards get private full-opacity copies while it has the
// focus; the shared atlas materials fade with the rest of the city.
const focusSigns = (b, on) => eachMat(b.mesh, (m, o) => {
  if (o.name !== 'repo-sign') return;
  if (on) {
    if (o.userData.signMats) return;
    o.userData.signMats = o.material;
    o.material = o.material.map((x) => {
      const c = x.clone();
      // The shared atlas may already be mid-fade; the private copy starts from
      // the original colour so stop #2 onward isn't 30% darker than stop #1.
      const f = faded.get(x);
      if (f?.origColor) c.color.copy(f.origColor);
      c.opacity = 1; c.transparent = true; c.depthWrite = true;
      c.userData = { shared: true }; // disposed by focusSigns(false), not disposeObject (the atlas texture is shared)
      return c;
    });
  } else if (o.userData.signMats) {
    for (const c of Array.isArray(o.material) ? o.material : [o.material]) c.dispose();
    o.material = o.userData.signMats;
    o.userData.signMats = null;
  }
});

// Window glow is re-applied every frame by app.js from the day/night curve, so
// the fade can't just write emissiveIntensity once. Each building carries an
// eased `ghost` level (0 = full, 1 = fully ghosted) and app.js scales by this.
export const focusGlowScale = (b) => 1 - (b.ghost || 0) * (1 - FOCUS_GLOW);

export function setFocusedBuilding(b) {
  // Tour legs outlive partial rebuilds: resolve the current mesh, not the disposed one.
  if (b?.repo?.full_name) b = buildingByName.get(b.repo.full_name) || null;
  if (b === focusEntry) return;
  const outline = getOutlineMat();
  // The previous focus's hulls rejoin the shared outline and its boards the shared atlases…
  if (focusEntry) {
    if (focusOutline) eachMat(focusEntry.mesh, (m, o) => { if (m === focusOutline) o.material = outline; });
    focusSigns(focusEntry, false);
  }
  focusEntry = b || null;
  fadeTo(outline, b ? FOCUS_DIM : 1);
  ghosting = true; // let the tick ease every building's glow to its new level
  const seenSign = new Set(); // sign atlas materials are shared: fade or restore them once
  for (const o of buildingMeshes) {
    o.ghostTarget = b && o !== b ? 1 : 0;
    if (o.ghost === undefined || o === b) o.ghost = 0;
    const casts = !o.ghostTarget;
    o.mesh.traverse((c) => {
      if (!c.isMesh) return;
      if (c.userData.casts0 === undefined) c.userData.casts0 = c.castShadow; // only ever re-enable real casters
      c.castShadow = casts && c.userData.casts0;
    });
    eachMat(o.mesh, (m, mesh) => {
      if (m === outline || m === focusOutline) return; // hulls are handled per mesh
      if (mesh.name === 'repo-sign') {
        if (o === b || seenSign.has(m)) return; // the focus's private copies stay full
        seenSign.add(m);
        const f = faded.get(m);
        const orig = f ? f.origOpacity : m.opacity;
        if (!b) { if (f) f.target = orig; } else fadeTo(m, orig * FOCUS_DIM);
        return;
      }
      const f = faded.get(m);
      const orig = f ? f.origOpacity : m.opacity;
      if (o === b) { if (f) { restoreMaterial(m, f); faded.delete(m); } } // the selected building occludes ghosts immediately
      else if (!b) { if (f) f.target = orig; }
      else fadeTo(m, orig * FOCUS_DIM);
    });
  }
  // …and the new focus gets crisp hulls and boards while the shared ones fade.
  if (b) {
    if (!focusOutline) { focusOutline = outline.clone(); focusOutline.userData = { shared: true }; } // survives disposeObject, like the shared one
    focusOutline.opacity = 1; focusOutline.transparent = false; focusOutline.depthWrite = true;
    focusOutline.needsUpdate = true;
    eachMat(b.mesh, (m, o) => { if (m === outline) o.material = focusOutline; });
    focusSigns(b, true);
  }
}

export function tickBuildingFocus(dt) {
  const k = Math.min(1, dt * FOCUS_EASE);
  if (ghosting) {
    let moving = false;
    for (const o of buildingMeshes) {
      const t = o.ghostTarget || 0;
      o.ghost += (t - (o.ghost || 0)) * k;
      if (Math.abs(t - o.ghost) < 0.005) o.ghost = t; else moving = true;
    }
    if (!moving) ghosting = false;
  }
  if (!faded.size) return;
  for (const [m, f] of faded) {
    m.opacity += (f.target - m.opacity) * k;
    // The colour dims alongside (k runs 1 → FOCUS_DARK as the fade comes in)…
    f.k += ((f.target < f.origOpacity ? FOCUS_DARK : 1) - f.k) * k;
    if (f.origColor) m.color.copy(f.origColor).multiplyScalar(f.k);
    else if (m.userData?.tinted) m.userData.focusK = f.k; // its own writer applies this
    if (Math.abs(f.target - m.opacity) >= 0.01) continue;
    m.opacity = f.target;
    if (f.target === f.origOpacity) { // …and everything is restored on the way back
      restoreMaterial(m, f);
      faded.delete(m);
    }
  }
}

// Put every tracked material back to how it looked and stop tracking it. Safe
// on materials that were just disposed (they're plain objects either way), and
// needed for the ones that weren't: a partial rebuild leaves the surviving
// buildings tracked, and dropping them from `faded` alone would strand them
// mid-fade forever.
function restoreMaterial(m, f) {
  m.opacity = f.origOpacity;
  if (m.transparent !== f.origTransparent) { m.transparent = f.origTransparent; m.needsUpdate = true; }
  m.depthWrite = f.origDepthWrite;
  if (f.origColor) m.color.copy(f.origColor);
  else if (m.userData?.tinted) delete m.userData.focusK;
}

function restoreFaded() {
  for (const [m, f] of faded) restoreMaterial(m, f);
  faded.clear();
}

// City rebuild: the focus and every fade it set are about to dangle, so undo
// the lot. Whatever survives the rebuild comes back at full strength.
function clearFocusState() {
  const outline = getOutlineMat();
  if (focusEntry) {
    if (focusOutline) eachMat(focusEntry.mesh, (m, o) => { if (m === focusOutline) o.material = outline; });
    focusSigns(focusEntry, false); // also disposes the private sign clones disposeObject skips
  }
  restoreFaded();
  for (const o of buildingMeshes) {
    o.ghost = o.ghostTarget = 0;
    o.mesh.traverse((c) => { if (c.isMesh && c.userData.casts0 !== undefined) c.castShadow = c.userData.casts0; });
  }
  ghosting = false;
  focusEntry = null;
}

// A partial rebuild (app.js refreshBuildings: a building config arrived) swaps
// some buildings out from under a running tour and re-makes every sign atlas,
// so the focus entry and half the tracked materials are disposed. Drop all of
// it and re-apply the focus to whatever stands in the old building's place.
export function refocusAfterRebuild() {
  if (!focusEntry) return;
  const name = focusEntry.repo?.full_name;
  clearFocusState();
  const b = name ? buildingByName.get(name) : null;
  if (!b) return;
  setFocusedBuilding(b);
  // Re-applying starts every material back at full opacity, which would flash
  // the whole city bright for a few frames. The fade was already in place, so
  // land it this instant instead of easing it in again.
  tickBuildingFocus(1e3);
}


export function createBuilding(repo, x, z, h, f, color, bcfg = null) { // bcfg: building config (city.json repos[name] + building.json)
  const form = bcfg?.style;
  const group = new THREE.Group();
  const rnd = seededRandom(hashStr(repo.full_name || repo.name || ''));
  const detailRnd = seededRandom(hashStr((repo.full_name || repo.name || '') + ':architecture'));
  const pal = buildingPalette(color, detailRnd());
  const towerPlan = h >= 28 && !form ? skyscraperPlan(h, f, hashStr((repo.full_name || repo.name || '') + ':skyline') % 5) : null;
  const architecture = towerPlan ? ARCHITECTURES.find(a => a.name === towerPlan.family) : ARCHITECTURES[Math.floor(detailRnd() * ARCHITECTURES.length)];
  const style = architecture.windows;
  const details = architectureDetails(group, architecture.name, pal, detailRnd);
  const litProb = 0.45 + rnd() * 0.4;

  // Silhouette: tall towers step back in tiers; small ones may get a hip roof.
  let tiers;
  if (h >= 28 && rnd() > 0.3) tiers = [{ h: h * 0.46, f }, { h: h * 0.32, f: f * 0.8 }, { h: h * 0.22, f: f * 0.62 }];
  else if (h >= 15 && rnd() > 0.35) tiers = [{ h: h * 0.6, f }, { h: h * 0.4, f: f * 0.74 }];
  else tiers = [{ h, f }];
  // Keep the ground footprint stable for lot placement and shop signs. Upper
  // sections vary from broad shoulders to a narrow shaft or a small penthouse.
  const silhouette = Math.floor(detailRnd() * 5);
  if (h >= 12 && silhouette === 0) tiers = [{ h: h * 0.22, f }, { h: h * 0.78, f: f * 0.66 }];
  else if (h >= 12 && silhouette === 1) tiers = [{ h: h * 0.84, f }, { h: h * 0.16, f: f * 0.58 }];
  else if (h >= 20 && silhouette === 2) tiers = [{ h: h * 0.38, f }, { h: h * 0.28, f: f * 0.86 }, { h: h * 0.21, f: f * 0.7 }, { h: h * 0.13, f: f * 0.54 }];
  if (architecture.name === 'garden' && h >= 12) tiers = [{ h: h * 0.38, f }, { h: h * 0.34, f: f * 0.73 }, { h: h * 0.28, f: f * 0.46 }];
  if (architecture.name === 'glass' && h >= 12) tiers = [{ h: h * 0.16, f }, { h: h * 0.84, f: f * 0.88 }];
  let hip = tiers.length === 1 && h < 9 && rnd() > 0.45;
  // city.json style changes the silhouette only (height and footprint still follow
  // the stars); applied after the draws above so the rest of the building is unchanged.
  if (form === 'tower') { tiers = [{ h, f }]; hip = false; } // one shaft; the spire goes on below
  else if (form === 'stepped') { tiers = h >= 8 ? [{ h: h * 0.5, f }, { h: h * 0.3, f: f * 0.78 }, { h: h * 0.2, f: f * 0.6 }] : [{ h: h * 0.62, f }, { h: h * 0.38, f: f * 0.72 }]; hip = false; }
  else if (form === 'cottage') { tiers = [{ h, f }]; hip = true; }
  else if (form === 'block') { tiers = [{ h, f }]; hip = false; }
  if (towerPlan) { tiers = towerPlan.tiers; hip = false; }
  const neon = bcfg?.neon ? hexNum(bcfg.neon) : 0xffffff; // building config "neon": the lit windows' glow

  const roofH = 0.7, over = 0.45;
  const roofMat = toonMat({ color: pal.roof });
  const propMat = toonMat({ color: 0xdfe3ec });
  const propDark = toonMat({ color: 0x3a4152 });
  const bodies = [], bodyMats = [], hulls = [];
  let baseY = 0, topY = 0, topF = f, cx = 0, cz = 0;
  tiers.forEach((t, i) => {
    const tf = Math.max(towerPlan ? 0.8 : 2.2, t.f), td = t.depth || tf;
    if (towerPlan) { baseY = t.base; cx = t.x; cz = t.z; }
    if (i > 0 && !towerPlan) {
      // Upper tiers sit slightly off-centre so towers aren't perfectly symmetric.
      const slack = (Math.max(2.2, tiers[i - 1].f) - tf) / 2 * (architecture.name === 'garden' ? 0 : 0.7);
      cx += (rnd() - 0.5) * 2 * slack; cz += (rnd() - 0.5) * 2 * slack;
    }
    const { map, emissiveMap } = paintFacade(rnd, pal, tf, t.h, { ground: i === 0, style, litProb });
    const mat = toonMat({ color: 0xffffff, map, emissive: neon, emissiveMap, emissiveIntensity: 0 });
    let geometry;
    if (t.shape === 'octagon') {
      geometry = new THREE.CylinderGeometry(tf * t.taper / 2, tf / 2, t.h, 8, 1, false);
      // Four facade repeats around the tower, with continuous floor heights.
      const uv = geometry.attributes.uv;
      for (let v = 0; v < uv.count; v++) uv.setX(v, uv.getX(v) * 4);
      map.wrapS = emissiveMap.wrapS = THREE.RepeatWrapping;
    } else geometry = new THREE.BoxGeometry(tf, t.h, td);
    const body = new THREE.Mesh(geometry, mat);
    body.rotation.y = t.rotation || 0;
    body.position.set(cx, baseY + t.h / 2, cz);
    body.castShadow = body.receiveShadow = true;
    group.add(body); bodies.push(body); bodyMats.push(mat);
    if (!t.bare && t.shape !== 'octagon') details.tier({ x: cx, z: cz, y: baseY, w: tf, h: t.h,
      roofHeight: towerPlan && i < tiers.length - 1 ? 0.18 : roofH, terraces: towerPlan?.name === 'terraces',
      rotation: t.rotation || 0, nextW: tiers[i + 1] ? Math.max(towerPlan ? 0.8 : 2.2, tiers[i + 1].f) : null });
    const o = towerPlan ? 0.12 : i === 0 ? over : over * 0.6;
    const capH = t.cap === false ? 0 : towerPlan && i < tiers.length - 1 ? 0.18 : roofH;
    if (capH) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(tf + o, capH, td + o), roofMat);
      cap.position.set(cx, baseY + t.h + capH / 2, cz);
      cap.rotation.y = t.rotation || 0;
      cap.castShadow = true;
      group.add(cap);
    }
    const hull = t.shape === 'octagon'
      ? new THREE.Mesh(hullOf(geometry, 0.18), getOutlineMat())
      : outlineBox(tf + o, t.h + capH, td + o, towerPlan ? 0.15 : 0.34);
    hull.raycast = noRaycast;
    hull.rotation.y = t.rotation || 0;
    hull.position.set(cx, baseY + (t.h + capH) / 2, cz);
    group.add(hull); hulls.push(hull);
    baseY += t.h + capH; topY = baseY; topF = tf;
  });

  const designedRoof = !hip && !bcfg?.roof && form !== 'tower' && form !== 'block' && ['deco', 'garden', 'heritage', 'loft'].includes(architecture.name);
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
  } else if (designedRoof) {
    details.roof({ x: cx, z: cz, y: topY, w: topF });
  } else {
    // Half the flat roofs get a painted top-down decal (helipad, garden,
    // gravel + HVAC, solar); the rest keep their 3D props.
    const decalRoof = !!world && topF >= 3.2 && rnd() < 0.5;
    if (decalRoof) {
      const d = world.roofDecal(Math.floor(rnd() * 4), topF + (tiers.length === 1 ? over : over * 0.6) - 0.5, { own: true }); // own material: the tour-focus fade ghosts it per building
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

  details.finish();

  // Building config "graffiti" (ground-floor walls) and "flag" (roof, or the cottage's ridge).
  if (bcfg?.graffiti) addGraffiti(group, bcfg.graffiti, { half: Math.max(2.2, tiers[0].f) / 2, height: tiers[0].h, x, z, seed: repo.full_name || repo.name || '' });
  if (bcfg?.flag) addRoofFlag(group, bcfg.flag, hip ? { x: cx, y: topY + 1.7, z: cz } : { x: cx - topF / 2 + 0.55, y: topY, z: cz + topF / 2 - 0.55 }, propDark);

  // Rooftop beacon for the most-starred repos (a glowing cap light).
  let beacon = null;
  if (repo.stargazers_count >= 100) {
    beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 10, 10),
      toonMat({ color: 0xffa03a, emissive: 0xff8a1a, emissiveIntensity: 1.4 }));
    const crownBeacon = designedRoof && architecture.name === 'deco';
    const roofRise = designedRoof ? ({ deco: 4.55, heritage: 1.95, garden: 0.85, loft: 0.8 }[architecture.name] || 0.4) : 0.4;
    beacon.position.set(crownBeacon ? cx : cx + topF / 2 - 0.8, topY + (hip ? 2.1 : roofRise), crownBeacon ? cz : cz - topF / 2 + 0.8);
    group.add(beacon);
  }

  group.position.set(x, 0, z);
  group.userData.repo = repo;
  group.userData.skyscraper = towerPlan?.name || null;
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
    const d = world.roofDecal(ROOF_DECAL[kind], size - 0.5, { own: true }); // own material: fades with its building on tour focus
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
