/*
 * Git City — the cartoon world around the city block.
 *
 * Everything outside the repo grid lives here: a blobby grass island sitting
 * in toon water, a ring of painted hills on the horizon, paper-cutout trees /
 * bushes / houses / street props, drifting cloud cutouts, and the top-down
 * decals used for empty lots and rooftops. The cutout art is a small set of
 * pre-generated PNGs in ./assets (cel-shaded, ink outlines, chroma-keyed).
 *
 * THREE is passed in by the host so this module works with its import map.
 */

// How many sprites each sheet was split into (see tools/ — assets are static).
export const SPRITE_COUNTS = { clouds: 4, trees: 5, bushes: 5, props: 6, houses: 6, landmarks: 4, lots: 4, roofs: 4 };
export const PROP = { LAMP: 0, BENCH: 1, HYDRANT: 2, MAILBOX: 3, CART: 4, BUS_STOP: 5 };
export const LANDMARK = { BALLOON: 0, LIGHTHOUSE: 1, WINDMILL: 2, FERRIS: 3 };

// Rounded rectangle centred on the origin. Pass THREE.Path as `Cls` to get a
// path usable with getPointAt() (cars, prop placement) instead of a Shape.
export function roundedRect(THREE, half, r, Cls = THREE.Shape) {
  const s = new Cls();
  s.moveTo(-half + r, -half);
  s.lineTo(half - r, -half);
  s.absarc(half - r, -half + r, r, -Math.PI / 2, 0, false);
  s.lineTo(half, half - r);
  s.absarc(half - r, half - r, r, 0, Math.PI / 2, false);
  s.lineTo(-half + r, half);
  s.absarc(-half + r, half - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-half, -half + r);
  s.absarc(-half + r, -half + r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  return s;
}

// A flat rounded-rect ring (outer minus inner), lying in the XZ plane.
export function roundedRingGeometry(THREE, outerHalf, outerR, innerHalf, innerR) {
  const shape = roundedRect(THREE, outerHalf, outerR);
  shape.holes.push(roundedRect(THREE, innerHalf, innerR, THREE.Path));
  const geo = new THREE.ShapeGeometry(shape, 12);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// Organic island outline: a circle with three low-frequency wobbles.
function islandShape(THREE, R, rnd) {
  const s = new THREE.Shape();
  const N = 112;
  const ph = [rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const k = 1 + 0.10 * Math.sin(3 * a + ph[0]) + 0.06 * Math.sin(5 * a + ph[1]) + 0.03 * Math.sin(9 * a + ph[2]);
    const x = Math.cos(a) * R * k, y = Math.sin(a) * R * k;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function createWorld(THREE, scene, deps) {
  const { envMat, seededRandom, DISTRICT, CELL, slabHalf, slabRadius, base = './assets/' } = deps;
  const rnd = seededRandom(0xC17E);
  const loader = new THREE.TextureLoader();
  const tints = [];      // { mat, night, day } — recoloured by setDay
  const billboards = []; // upright cutouts that turn to face the camera (Y only)
  const floaters = [];   // { mesh, y, phase, speed } bobbing / drifting cutouts
  const shadowSpots = [];// { x, y, z, w } blob shadows under cutouts
  const texCache = new Map();
  const matCache = new Map();

  // ---- textures & materials -------------------------------------------------
  function getTex(name) {
    if (texCache.has(name)) return texCache.get(name);
    const entry = { tex: null, ready: null, aspect: 1 };
    entry.ready = new Promise((resolve) => {
      entry.tex = loader.load(`${base}${name}.png`, (t) => {
        entry.aspect = t.image.width / t.image.height;
        resolve(entry);
      }, undefined, () => resolve(entry));
    });
    entry.tex.colorSpace = THREE.SRGBColorSpace;
    entry.tex.anisotropy = 4;
    entry.tex.userData.shared = true; // never disposed with a building / lot group
    texCache.set(name, entry);
    return entry;
  }
  // One material per sprite so day/night tinting is a single colour write.
  function cutoutMat(name, { night = 0x55627f, day = 0xffffff, opaque = true } = {}) {
    const key = `${name}|${night}|${day}|${opaque}`;
    if (matCache.has(key)) return matCache.get(key);
    const { tex } = getTex(name);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide,
      ...(opaque ? { alphaTest: 0.5 } : { transparent: true, depthWrite: false }),
    });
    mat.userData.shared = true;
    tints.push({ mat, night: new THREE.Color(night), day: new THREE.Color(day) });
    matCache.set(key, mat);
    return mat;
  }

  const unitPlane = new THREE.PlaneGeometry(1, 1);
  unitPlane.translate(0, 0.5, 0); // pivot at the base so the cutout stands on the ground
  const unitDecal = new THREE.PlaneGeometry(1, 1);
  unitDecal.rotateX(-Math.PI / 2);

  // An upright paper cutout of `height` world units, anchored at its base.
  function cutout(name, height, x, y, z, { shadow = true, parent = scene, face = true } = {}) {
    const entry = getTex(name);
    const mesh = new THREE.Mesh(unitPlane, cutoutMat(name));
    mesh.visible = false;
    mesh.position.set(x, y, z);
    mesh.raycast = () => {};
    entry.ready.then(() => {
      mesh.scale.set(height * entry.aspect, height, 1);
      mesh.visible = true;
    });
    parent.add(mesh);
    if (face) billboards.push(mesh);
    if (shadow) shadowSpots.push({ x, y: y + 0.03, z, w: height * 0.55 });
    return mesh;
  }
  // A flat top-down decal (lots, roofs). `size` is the square side length.
  function decal(name, size) {
    const entry = getTex(name);
    const mesh = new THREE.Mesh(unitDecal, cutoutMat(name, { night: 0x3b4660, day: 0xffffff }));
    mesh.scale.set(size, 1, size);
    mesh.visible = false;
    mesh.raycast = () => {};
    entry.ready.then(() => { mesh.visible = true; });
    return mesh;
  }

  // ---- island + water + beach ----------------------------------------------
  const ISLAND_R = 165;
  const grass = getTex('grass').tex;
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(1 / 26, 1 / 26);
  const island = new THREE.Mesh(
    new THREE.ExtrudeGeometry(islandShape(THREE, ISLAND_R, rnd), { depth: 3, bevelEnabled: false, curveSegments: 1 }),
    [envMat(0x2a3a4a, 0xffffff, { map: grass }), envMat(0x3a2c22, 0xc8a878)]);
  island.rotation.x = -Math.PI / 2;
  island.position.y = -3.06; // top face lands at -0.06, just under the slab
  island.receiveShadow = true;
  scene.add(island);

  // Sandy beach: a slightly larger flat copy of the island sitting at the waterline.
  const beach = new THREE.Mesh(new THREE.ShapeGeometry(islandShape(THREE, ISLAND_R * 1.06, seededRandom(0xC17E)), 1),
    envMat(0x4a3d2e, 0xf1dfae));
  beach.rotation.x = -Math.PI / 2;
  beach.position.y = -1.05;
  scene.add(beach);

  const water = getTex('water').tex;
  water.wrapS = water.wrapT = THREE.RepeatWrapping;
  water.repeat.set(1 / 34, 1 / 34);
  const waterMat = envMat(0x18263f, 0xffffff, { map: water });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), waterMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -1.25;
  scene.add(sea);

  // ---- painted hills on the horizon ----------------------------------------
  const hillsTex = getTex('hills').tex;
  hillsTex.wrapS = THREE.MirroredRepeatWrapping; // guarantees a continuous seam
  hillsTex.repeat.set(12, 1);
  const HILL_R = 440, HILL_H = 92;
  const hillMat = new THREE.MeshBasicMaterial({ map: hillsTex, side: THREE.BackSide, alphaTest: 0.5, fog: false });
  tints.push({ mat: hillMat, night: new THREE.Color(0x1b2438), day: new THREE.Color(0xffffff) });
  const hills = new THREE.Mesh(new THREE.CylinderGeometry(HILL_R, HILL_R, HILL_H, 96, 1, true), hillMat);
  hills.position.y = HILL_H / 2 - 4;
  scene.add(hills);

  // ---- clouds: cutouts drifting at three depths -----------------------------
  const clouds = [];
  for (let i = 0; i < 20; i++) {
    const k = i % SPRITE_COUNTS.clouds;
    const entry = getTex(`clouds-${k}`);
    const mat = new THREE.SpriteMaterial({ map: entry.tex, transparent: true, depthWrite: false, opacity: 0.96 });
    tints.push({ mat, night: new THREE.Color(0x4f5c7c), day: new THREE.Color(0xffffff) });
    const sp = new THREE.Sprite(mat);
    // Clouds live above the camera's orbit band (the camera tops out around
    // y≈95 at max zoom-out) and outside the block, at three depths.
    const layer = i % 3;                            // 0 near/low, 2 far/high
    const r = 175 + layer * 80 + rnd() * 70;
    const h = 112 + layer * 18 + rnd() * 14;
    const w = 22 + layer * 10 + rnd() * 12;
    sp.visible = false;
    entry.ready.then(() => { sp.scale.set(w, w / entry.aspect, 1); sp.visible = true; });
    sp.userData = { angle: rnd() * Math.PI * 2, r, h, speed: (0.010 + rnd() * 0.012) * (layer === 1 ? -1 : 1) };
    scene.add(sp);
    clouds.push(sp);
  }

  // ---- greenery around the block --------------------------------------------
  // A verge of bushes hugging the curb, then a ring of trees behind it, both
  // following the slab's rounded outline so the grid melts into the island.
  const along = (offset, n, fn) => {
    const path = roundedRect(THREE, slabHalf + offset, slabRadius + offset, THREE.Path);
    for (let i = 0; i < n; i++) {
      const p = path.getPointAt(((i + rnd() * 0.4) / n) % 1);
      fn(p.x, p.y, i);
    }
  };
  along(3.2, 54, (x, z, i) => {
    if (i % 5 === 0) return; // gaps so the verge doesn't read as a hedge wall
    cutout(`bushes-${Math.floor(rnd() * SPRITE_COUNTS.bushes)}`, 1.6 + rnd() * 1.2, x, -0.05, z);
  });
  along(7.5, 40, (x, z) => {
    cutout(`trees-${Math.floor(rnd() * SPRITE_COUNTS.trees)}`, 5 + rnd() * 3.5, x, -0.05, z);
  });
  // Street furniture on the sidewalk band just outside the boulevard.
  const furniture = [PROP.BENCH, PROP.HYDRANT, PROP.MAILBOX, PROP.BUS_STOP, PROP.BENCH, PROP.CART];
  along(-2.4, 30, (x, z, i) => {
    const kind = furniture[i % furniture.length];
    const h = kind === PROP.CART ? 2.6 : kind === PROP.BUS_STOP || kind === PROP.LAMP ? 3.2 : 1.3;
    cutout(`props-${kind}`, h, x, 0.02, z, { shadow: kind !== PROP.BUS_STOP });
  });

  // Woods and a couple of villages out on the island.
  const placeCluster = (name, count, cx, cz, spread, hmin, hmax, variants) => {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * spread;
      cutout(`${name}-${Math.floor(rnd() * variants)}`, hmin + rnd() * (hmax - hmin), cx + Math.cos(a) * d, -0.05, cz + Math.sin(a) * d);
    }
  };
  const ringSpot = (a, r) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  for (let i = 0; i < 9; i++) {
    const { x, z } = ringSpot((i / 9) * Math.PI * 2 + rnd() * 0.4, 88 + rnd() * 48);
    placeCluster('trees', 6 + Math.floor(rnd() * 6), x, z, 12, 5, 9, SPRITE_COUNTS.trees);
  }
  for (let i = 0; i < 3; i++) {
    const { x, z } = ringSpot((i / 3) * Math.PI * 2 + 0.9, 105 + rnd() * 25);
    placeCluster('houses', 5 + Math.floor(rnd() * 4), x, z, 14, 5, 7, SPRITE_COUNTS.houses);
    placeCluster('trees', 4, x, z, 18, 4, 7, SPRITE_COUNTS.trees);
  }
  // Landmarks: lighthouse on the shore, windmill and ferris wheel inland,
  // hot-air balloons drifting over the bay.
  {
    const lh = ringSpot(0.55, ISLAND_R * 0.93);
    cutout(`landmarks-${LANDMARK.LIGHTHOUSE}`, 16, lh.x, -0.05, lh.z);
    const wm = ringSpot(2.5, 122);
    cutout(`landmarks-${LANDMARK.WINDMILL}`, 15, wm.x, -0.05, wm.z);
    const fw = ringSpot(4.3, 112);
    cutout(`landmarks-${LANDMARK.FERRIS}`, 18, fw.x, -0.05, fw.z);
    for (let i = 0; i < 3; i++) {
      const b = cutout(`landmarks-${LANDMARK.BALLOON}`, 11, 0, 30, 0, { shadow: false });
      floaters.push({ mesh: b, angle: rnd() * Math.PI * 2, r: 95 + rnd() * 50, y: 30 + rnd() * 16, phase: rnd() * 6, speed: 0.012 + rnd() * 0.01 });
    }
  }

  // ---- blob shadows: one instanced disc under every grounded cutout ---------
  const shadowGeo = new THREE.CircleGeometry(0.5, 14);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(shadowGeo,
    new THREE.MeshBasicMaterial({ color: 0x0a0d16, transparent: true, opacity: 0.22, depthWrite: false }), shadowSpots.length);
  {
    const m = new THREE.Matrix4();
    shadowSpots.forEach((s, i) => { m.makeScale(s.w, 1, s.w * 0.55).setPosition(s.x, s.y, s.z); shadows.setMatrixAt(i, m); });
    shadows.instanceMatrix.needsUpdate = true;
    shadows.raycast = () => {};
    scene.add(shadows);
  }

  // ---- per-user decals: empty lots ------------------------------------------
  let lotGroup = null;
  function setLots(cells) {
    if (lotGroup) { scene.remove(lotGroup); lotGroup = null; }
    lotGroup = new THREE.Group();
    for (const c of cells) {
      const r = seededRandom(c.seed);
      if (r() > 0.6) continue; // leave some lots plain so the district stays airy
      const d = decal(`lots-${Math.floor(r() * SPRITE_COUNTS.lots)}`, CELL - 3.2 - 0.6);
      d.position.set(c.x, 0.035, c.z);
      d.rotation.y = Math.floor(r() * 4) * Math.PI / 2;
      lotGroup.add(d);
    }
    scene.add(lotGroup);
  }
  function roofDecal(k, size) { return decal(`roofs-${k % SPRITE_COUNTS.roofs}`, size); }

  // ---- per-frame -------------------------------------------------------------
  let cloudOpacity = 0.95;
  function setDay(day) {
    for (const t of tints) t.mat.color.copy(t.night).lerp(t.day, day);
    cloudOpacity = 0.55 + day * 0.4;
  }
  // Distance from point p to the segment a→b (camera → orbit target).
  const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _q = new THREE.Vector3();
  function distToSegment(p, a, b) {
    _ab.subVectors(b, a); _ap.subVectors(p, a);
    const t = THREE.MathUtils.clamp(_ap.dot(_ab) / Math.max(1e-6, _ab.lengthSq()), 0, 1);
    return _q.copy(a).addScaledVector(_ab, t).distanceTo(p);
  }
  function update(dt, elapsed, camera, target) {
    water.offset.x += dt * 0.0016; water.offset.y += dt * 0.0009; // a lazy drift, not a river
    for (const c of clouds) {
      const u = c.userData;
      u.angle += u.speed * dt;
      c.position.set(Math.cos(u.angle) * u.r, u.h + Math.sin(elapsed * 0.2 + u.r) * 1.5, Math.sin(u.angle) * u.r);
      // Never let a cloud sit on the lens or between the camera and the city:
      // fade it out as it nears the camera's line of sight.
      const clear = c.scale.x * 0.9;
      const d = target ? distToSegment(c.position, camera.position, target) : c.position.distanceTo(camera.position);
      const near = c.position.distanceTo(camera.position);
      c.material.opacity = cloudOpacity * THREE.MathUtils.smoothstep(d, clear * 0.6, clear * 1.4) * THREE.MathUtils.smoothstep(near, 45, 90);
    }
    for (const f of floaters) {
      f.angle += f.speed * dt;
      f.mesh.position.set(Math.cos(f.angle) * f.r, f.y + Math.sin(elapsed * 0.6 + f.phase) * 1.8, Math.sin(f.angle) * f.r);
    }
    const cx = camera.position.x, cz = camera.position.z;
    for (const b of billboards) b.rotation.y = Math.atan2(cx - b.position.x, cz - b.position.z);
  }

  return { setDay, update, setLots, roofDecal, cutout, islandRadius: ISLAND_R, _parts: { island, beach, sea, hills, clouds, shadows } };
}
