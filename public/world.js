/*
 * Git City — the cartoon world around the city block.
 *
 * Everything outside the repo grid lives here, and it is generated from the
 * GitHub profile: the same login always gets the same island.
 *
 *  - The login seeds the layout: coastline, villages, highlands, lakes, islets.
 *  - The top language picks the biome (systems languages get alpine peaks and
 *    pine woods, web languages a tropical island, data languages a lakeland,
 *    enterprise languages farmland meadows, scripting languages a savanna).
 *  - Stars + followers decide how many attractions the island has (a big one
 *    — the roller coaster — needs ~1k), the repo count how many villages, the
 *    account age how old and dense the woods are, recent pushes the boats.
 *
 * The island is a heightfield: meadows that stay flat around the city block,
 * villages and attraction sites, wooded highlands, lakes that drain to the sea
 * through little rivers (both are just dips below the sea plane, so the sea
 * shows through). Beaches get shallow water and a breathing foam line. Dirt
 * roads leave the block for the villages, the lighthouse and the fair.
 *
 * Cutout art (trees, bushes, houses, props, landmarks) is a small set of
 * pre-generated PNGs in ./assets. Static cutouts are batched into one
 * InstancedMesh per sprite that turns to face the camera in the vertex shader,
 * so thousands of them cost a handful of draw calls. 3D attractions come from
 * ./attractions.js (loaded lazily; the island works without it).
 *
 * THREE is passed in by the host so this module works with its import map.
 */

// How many sprites each sheet was split into (scripts/assets/, docs/assets.md).
export const SPRITE_COUNTS = { clouds: 4, trees: 10, bushes: 10, props: 10, houses: 6, landmarks: 5, lots: 4, roofs: 4 };
export const PROP = { LAMP: 0, BENCH: 1, HYDRANT: 2, MAILBOX: 3, CART: 4, BUS_STOP: 5, BUS_SHELTER: 6, TRASH_BIN: 7, NEWS_STAND: 8, BIKE_RACK: 9 };
export const LANDMARK = { BALLOON: 0, LIGHTHOUSE: 1, WINDMILL: 2, FERRIS: 3, ROCKET: 4 };
// Attraction sites buildLand() reserves before the terrain: the ground each
// kind offers (attractions.js tags + footprint radius). farm0..farm3 are the
// fields by each village, fair2 a second fair lot.
export const SITE_KINDS = {
  bigFair: { tag: 'fair', r: 19 }, fair: { tag: 'fair', r: 11 }, farm: { tag: 'farm', r: 11 },
  peak: { tag: 'hill', r: 7 }, coast: { tag: 'coast', r: 7 }, slopes: { tag: 'hill', r: 16 }, wild: { tag: 'wild', r: 8 },
};
// city.json "landmarks": the sites that can hold each attraction, best first.
export const LANDMARK_SITES = {
  rollerCoaster: ['bigFair'],
  carousel: ['fair', 'fair2', 'bigFair'],
  circusTent: ['fair', 'fair2', 'bigFair'],
  dropTower: ['fair2', 'fair', 'bigFair'],
  windTurbines: ['slopes'],
  windmill: ['farm0', 'farm1', 'farm2', 'farm3', 'peak'],
  farm: ['farm0', 'farm1', 'farm2', 'farm3'],
  campsite: ['coast', 'wild'],
  radioTower: ['peak', 'wild'],
  observatory: ['peak', 'slopes'],
  balloonPad: ['peak', 'farm0', 'fair2', 'farm1'],
  lighthouse: ['coast', 'peak'],
  recordShop: ['fair2', 'fair', 'bigFair'],
  robotMonument: ['wild', 'slopes'],
};
const TREE = { OAK: 0, POPLAR: 1, PINE: 2, ROUND: 3, CHERRY: 4, WILLOW: 5, BIRCH: 6, ACACIA: 7, BAOBAB: 8, APPLE: 9 };
const BUSH = { ROUND: 0, TULIPS: 1, LEAFY: 2, GRASS: 3, TOPIARY: 4, SUNFLOWERS: 5, CACTUS: 6, REEDS: 7, STUMP: 8, FERN: 9 };
// The kerbside verge by the city block (willows and reeds grow by the water, below).
const VERGE_BUSHES = [BUSH.ROUND, BUSH.TULIPS, BUSH.LEAFY, BUSH.GRASS, BUSH.TOPIARY];

// Biomes: ground palette, relief, woods, water. Tree/bush lists are sprite
// indices, repeated to weight the pick.
export const BIOMES = {
  meadow: {
    label: 'Meadow isle',
    pal: { meadow: 0x8cda44, meadowLight: 0xacfa5d, forest: 0x5fb13c, highland: 0x7dbb62, rock: 0xb8ae9a, sand: 0xf1dfae, wetSand: 0xd6bd86 },
    relief: 15, mound: 1, forestT: 0.56, lakes: 1, river: true, beach: 1, shallow: 0x9af5e6, snow: 0,
    trees: [TREE.OAK, TREE.ROUND, TREE.ROUND, TREE.POPLAR, TREE.CHERRY, TREE.PINE, TREE.APPLE, TREE.BIRCH],
    bushes: [BUSH.ROUND, BUSH.TULIPS, BUSH.LEAFY, BUSH.GRASS, BUSH.SUNFLOWERS, BUSH.STUMP, BUSH.FERN],
  },
  alpine: {
    label: 'Alpine isle',
    pal: { meadow: 0x7fcf55, meadowLight: 0x9de36f, forest: 0x4c9a45, highland: 0x86a88a, rock: 0x7a7066, sand: 0xe6dcc0, wetSand: 0xc9bc98 },
    relief: 24, mound: 1.75, forestT: 0.5, lakes: 1, river: true, beach: 0.75, shallow: 0x8fe3ec, snow: 8.5,
    trees: [TREE.PINE, TREE.PINE, TREE.PINE, TREE.PINE, TREE.POPLAR, TREE.ROUND, TREE.BIRCH, TREE.BIRCH],
    bushes: [BUSH.ROUND, BUSH.LEAFY, BUSH.GRASS, BUSH.FERN, BUSH.FERN, BUSH.STUMP],
  },
  tropical: {
    label: 'Tropical isle',
    pal: { meadow: 0x96e04c, meadowLight: 0xb8f262, forest: 0x52b848, highland: 0x86cc5a, rock: 0xc9b89a, sand: 0xfbeac0, wetSand: 0xe9cf95 },
    relief: 8, mound: 0.65, forestT: 0.6, lakes: 1, river: false, beach: 1.9, shallow: 0x6ff5e0, snow: 0, palms: 80,
    trees: [TREE.ROUND, TREE.ROUND, TREE.OAK, TREE.POPLAR, TREE.CHERRY, TREE.CHERRY], bushes: [BUSH.TULIPS, BUSH.TULIPS, BUSH.LEAFY, BUSH.ROUND, BUSH.FERN, BUSH.FERN],
  },
  savanna: {
    label: 'Savanna isle',
    pal: { meadow: 0xd4c45a, meadowLight: 0xe8da7c, forest: 0xa3b24c, highland: 0xc9a46e, rock: 0xc99a6e, sand: 0xf3dba6, wetSand: 0xdcc088 },
    relief: 12, mound: 1.1, forestT: 0.68, lakes: 1, river: false, beach: 1.2, shallow: 0x9aeede, snow: 0,
    trees: [TREE.ACACIA, TREE.ACACIA, TREE.ACACIA, TREE.BAOBAB, TREE.OAK, TREE.POPLAR, TREE.ROUND],
    bushes: [BUSH.GRASS, BUSH.GRASS, BUSH.LEAFY, BUSH.ROUND, BUSH.CACTUS, BUSH.CACTUS, BUSH.SUNFLOWERS],
  },
  lakeland: {
    label: 'Lakeland isle',
    pal: { meadow: 0x7fd04a, meadowLight: 0x9be860, forest: 0x4f9e3a, highland: 0x78b466, rock: 0xafa898, sand: 0xeadcae, wetSand: 0xcdb888 },
    relief: 11, mound: 0.9, forestT: 0.5, lakes: 3, river: true, beach: 0.9, shallow: 0x94ecdf, snow: 0,
    trees: [TREE.PINE, TREE.PINE, TREE.ROUND, TREE.OAK, TREE.POPLAR, TREE.BIRCH, TREE.BIRCH],
    bushes: [BUSH.ROUND, BUSH.LEAFY, BUSH.GRASS, BUSH.TULIPS, BUSH.FERN, BUSH.STUMP],
  },
};
const BIOME_BY_LANG = {
  C: 'alpine', 'C++': 'alpine', Rust: 'alpine', Assembly: 'alpine', Zig: 'alpine', Nim: 'alpine', Fortran: 'alpine',
  JavaScript: 'tropical', TypeScript: 'tropical', HTML: 'tropical', CSS: 'tropical', SCSS: 'tropical', Vue: 'tropical', Svelte: 'tropical', Astro: 'tropical', CoffeeScript: 'tropical',
  Python: 'lakeland', 'Jupyter Notebook': 'lakeland', R: 'lakeland', Julia: 'lakeland', MATLAB: 'lakeland', TeX: 'lakeland',
  Go: 'meadow', Java: 'meadow', Kotlin: 'meadow', Scala: 'meadow', 'C#': 'meadow', Swift: 'meadow', Dart: 'meadow', 'Objective-C': 'meadow',
  Ruby: 'savanna', PHP: 'savanna', Elixir: 'savanna', Erlang: 'savanna', Haskell: 'savanna', Lua: 'savanna', Shell: 'savanna', Perl: 'savanna', Clojure: 'savanna', OCaml: 'savanna', 'Vim Script': 'savanna', 'Emacs Lisp': 'savanna',
};

const TAU = Math.PI * 2;
const PAD_FAME = 1.5; // worldTraits().fame (log10 of stars + followers) for a launch pad
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// What the island should look like for a profile ({ user, repos } as loaded
// by the app). Pure and deterministic apart from `boats` (recent activity).
export function worldTraits(profile = {}) {
  const user = profile.user || {}, repos = profile.repos || [];
  const login = String(user.login || 'git-city').toLowerCase();
  const seed = fnv(login);
  const score = {};
  for (const r of repos) if (r.language && !r.fork) score[r.language] = (score[r.language] || 0) + 1 + Math.log10(1 + (r.stargazers_count || 0));
  const topLang = Object.keys(score).sort((a, b) => score[b] - score[a])[0] || null;
  const keys = Object.keys(BIOMES);
  const biome = BIOME_BY_LANG[topLang] || keys[seed % keys.length];
  const stars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const fame = Math.log10(1 + stars + (user.followers || 0));
  const created = Date.parse(user.created_at || '') || Date.UTC(2020, 0, 1);
  const age = Math.min(1, Math.max(0, (Date.UTC(2026, 0, 1) - created) / (15 * 365.25 * 864e5)));
  const recent = repos.filter((r) => Date.now() - (Date.parse(r.pushed_at || '') || 0) < 90 * 864e5).length;
  const nRepos = user.public_repos ?? repos.length;
  return {
    login, seed, biome, topLang, fame, age,
    villages: 2 + (nRepos >= 25) + (nRepos >= 100),
    attractions: Math.max(1, Math.min(7, Math.round(fame))),
    boats: 2 + Math.min(6, recent),
    forest: 0.85 + age * 0.4,
  };
}

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

// Seeded 2D value noise folded into fBm. Returns 0..1.
function makeNoise(seed) {
  const hash = (ix, iz) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, z, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * noise(x * f + i * 17.3, z * f - i * 9.1);
      norm += amp; f *= 2.03; amp *= 0.5;
    }
    return s / norm;
  };
}

// Greedy word wrap into at most `maxLines` lines of ~`width` characters; the
// last line ends in an ellipsis when the text doesn't fit.
function wrapWords(text, width, maxLines) {
  const out = [''];
  for (const word of String(text).split(' ')) {
    const next = `${out[out.length - 1]} ${word}`.trim();
    if (next.length <= width) out[out.length - 1] = next;
    else if (out.length === maxLines) { out[out.length - 1] += '…'; break; }
    else out.push(word);
  }
  return out;
}

function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const ex = a.x + dx * t - x, ez = a.z + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Cylindrical billboard for instanced cutouts: each instance keeps its base
// position and scale from instanceMatrix and turns about Y to face the camera.
const BILLBOARD_VERTEX = /* glsl */`
  vec3 bbBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 bbScale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec3 bbFwd = cameraPosition - bbBase; bbFwd.y = 0.0;
  bbFwd = normalize(bbFwd + vec3(1e-4, 0.0, 0.0));
  vec3 bbRight = vec3(bbFwd.z, 0.0, -bbFwd.x);
  vec4 mvPosition = viewMatrix * vec4(bbBase + bbRight * transformed.x * bbScale.x + vec3(0.0, transformed.y * bbScale.y, 0.0), 1.0);
  gl_Position = projectionMatrix * mvPosition;
`;

export function createWorld(THREE, scene, deps) {
  const { envMat, seededRandom, DISTRICT, CELL, slabHalf, slabRadius, streetW = 3.2, base = './assets/' } = deps;
  const rnd = seededRandom(0xC17E); // persistent scenery only (clouds, balloons)
  const loader = new THREE.TextureLoader();
  const tints = [];      // { mat, night, day } — recoloured by setDay
  const billboards = []; // persistent upright cutouts that turn to face the camera
  const floaters = [];   // { mesh, y, phase, speed } bobbing / drifting cutouts
  const texCache = new Map();
  const matCache = new Map();
  const shared = (o) => { o.userData.shared = true; return o; };
  const noRay = (o) => { o.traverse((c) => { c.raycast = () => {}; }); return o; };
  const col = (hex) => new THREE.Color(hex);
  const attractionsMod = import('./attractions.js').catch(() => null);

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
      ...(opaque ? { alphaTest: 0.5, alphaToCoverage: true } : { transparent: true, depthWrite: false }),
    });
    mat.userData.shared = true;
    tints.push({ mat, night: new THREE.Color(night), day: new THREE.Color(day) });
    matCache.set(key, mat);
    return mat;
  }
  function billboardMat(name) {
    const key = `bb|${name}`;
    if (matCache.has(key)) return matCache.get(key);
    const mat = new THREE.MeshBasicMaterial({ map: getTex(name).tex, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
    mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', BILLBOARD_VERTEX); };
    mat.userData.shared = true;
    tints.push({ mat, night: new THREE.Color(0x55627f), day: new THREE.Color(0xffffff) });
    matCache.set(key, mat);
    return mat;
  }
  // envMat registers every material with the host's day/night palette, so
  // anything built per island goes through this cache instead of leaking.
  const envCache = new Map();
  function sharedEnvMat(night, day, extra = {}) {
    const key = `${night}|${day}|${Object.entries(extra).map(([k, v]) => `${k}:${v && typeof v === 'object' ? v.uuid ?? '?' : v}`).join(',')}`;
    if (!envCache.has(key)) envCache.set(key, shared(envMat(night, day, extra)));
    return envCache.get(key);
  }
  const inkMat = shared(new THREE.MeshBasicMaterial({ color: 0x0a0d16, side: THREE.BackSide }));

  const unitPlane = shared(new THREE.PlaneGeometry(1, 1));
  unitPlane.translate(0, 0.5, 0); // pivot at the base so the cutout stands on the ground
  const unitDecal = shared(new THREE.PlaneGeometry(1, 1));
  unitDecal.rotateX(-Math.PI / 2);

  // An upright paper cutout of `height` world units, anchored at its base.
  function cutout(name, height, x, y, z, { parent = scene, face = true, list = billboards } = {}) {
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
    if (face) list.push(mesh);
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

  // ---- persistent scenery: sea, far shore, painted hills, clouds, balloons ---
  const ISLAND_R = 165;
  const SEA_Y = -1.25;  // the sea plane: any ground below it reads as water
  const GROUND = -0.06; // meadow level, just under the paved slab

  const water = getTex('water').tex;
  water.wrapS = water.wrapT = THREE.RepeatWrapping;
  water.repeat.set(1 / 34, 1 / 34); // UVs are world units: one wave tile per 34
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1), envMat(0x18263f, 0xffffff, { map: water }));
  {
    const p = sea.geometry.attributes.position, uv = sea.geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i));
  }
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_Y;
  scene.add(noRay(sea));

  // The painted hill ring stands on a far shore instead of floating on the sea.
  {
    const farSand = new THREE.Mesh(new THREE.RingGeometry(402, 416, 160, 1), envMat(0x1a1f2a, 0xe9d7a4));
    farSand.rotation.x = -Math.PI / 2;
    farSand.position.y = SEA_Y + 0.25;
    const farLand = new THREE.Mesh(new THREE.RingGeometry(414, 600, 160, 1), envMat(0x0f1c20, 0x3f9a58));
    farLand.rotation.x = -Math.PI / 2;
    farLand.position.y = SEA_Y + 0.45;
    scene.add(noRay(farSand), noRay(farLand));
  }

  const hillsTex = getTex('hills').tex;
  hillsTex.wrapS = THREE.MirroredRepeatWrapping; // guarantees a continuous seam
  hillsTex.repeat.set(12, 1);
  const HILL_R = 440, HILL_H = 92;
  const hillMat = new THREE.MeshBasicMaterial({ map: hillsTex, side: THREE.BackSide, alphaTest: 0.5, alphaToCoverage: true, fog: false });
  tints.push({ mat: hillMat, night: new THREE.Color(0x1b2438), day: new THREE.Color(0xffffff) });
  const hills = new THREE.Mesh(new THREE.CylinderGeometry(HILL_R, HILL_R, HILL_H, 96, 1, true), hillMat);
  hills.position.y = HILL_H / 2 - 4;
  scene.add(noRay(hills));

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
    sp.raycast = () => {};
    scene.add(sp);
    clouds.push(sp);
  }
  for (let i = 0; i < 3; i++) {
    const b = cutout(`landmarks-${LANDMARK.BALLOON}`, 11, 0, 30, 0);
    floaters.push({ mesh: b, angle: rnd() * Math.PI * 2, r: 95 + rnd() * 50, y: 30 + rnd() * 16, phase: rnd() * 6, speed: 0.012 + rnd() * 0.01 });
  }

  // ---- shared materials & geometry for the per-profile island ----------------
  const detailTex = getTex('grass-detail').tex;
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.repeat.set(1 / 24, 1 / 24); // UVs are world XZ
  const groundMat = sharedEnvMat(0x34485c, 0xffffff, { map: detailTex, vertexColors: true });
  groundMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float grass;\nvarying float vGrass;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrass = grass;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGrass;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= mix(vec3(1.0), texture2D(map, vMapUv).rgb, vGrass);');
  };
  // Shallows: the same wave PNG as the sea, brightened and faded by vertex colour.
  const shallowMat = shared(new THREE.MeshBasicMaterial({ map: water, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const foamMat = shared(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const foam2Mat = foamMat.clone(); shared(foam2Mat);
  tints.push({ mat: shallowMat, night: col(0x2b3f63), day: col(0xffffff) },
    { mat: foamMat, night: col(0x6f7fa3), day: col(0xffffff) }, { mat: foam2Mat, night: col(0x6f7fa3), day: col(0xffffff) });

  const decalOpts = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const roadInk = sharedEnvMat(0x0b0e14, 0x6e5337, decalOpts);
  const roadDirt = sharedEnvMat(0x2a2620, 0xe4c38c, { ...decalOpts, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const FIELD_KINDS = [
    ['#f4d35e', '#dfae38'], // wheat
    ['#96da5e', '#62ad3d'], // young crops
    ['#bf8a57', '#95623a'], // ploughed
    ['#b8a0ec', '#8d73d6'], // lavender
    ['#f7a8b8', '#e0708a'], // tulips
  ];
  const fieldMats = FIELD_KINDS.map(([a, b], k) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = a; g.fillRect(0, 0, 256, 256);
    g.fillStyle = b;
    for (let y = 20; y < 236; y += 24) {
      g.beginPath(); g.roundRect(16, y, 224, 11, 5.5); g.fill();
      if (k === 1 || k === 4) {
        g.fillStyle = k === 1 ? '#3f8a2c' : '#fff1f4';
        for (let x = 26; x < 236; x += 18) { g.beginPath(); g.arc(x, y + 5.5, 3.2, 0, TAU); g.fill(); }
        g.fillStyle = b;
      }
    }
    g.lineWidth = 10; g.strokeStyle = '#1a2233'; g.lineJoin = 'round';
    g.beginPath(); g.roundRect(5, 5, 246, 246, 20); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.userData.shared = true;
    return sharedEnvMat(0x2a3a4a, 0xffffff, { map: tex, ...decalOpts });
  });
  const rockGeo = shared(new THREE.DodecahedronGeometry(1, 0));
  {
    const r = seededRandom(0x5EED), p = rockGeo.attributes.position, jit = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!jit.has(key)) jit.set(key, 0.78 + r() * 0.44);
      const j = jit.get(key);
      p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
    }
    rockGeo.computeVertexNormals();
  }
  const rockMat = sharedEnvMat(0x262b36, 0xffffff);
  const shadowGeo = shared(new THREE.CircleGeometry(0.5, 14));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = shared(new THREE.MeshBasicMaterial({ color: 0x0a0d16, transparent: true, opacity: 0.22, depthWrite: false }));
  const woodMat = sharedEnvMat(0x241d18, 0xc79866), postMat = sharedEnvMat(0x17120f, 0x7a5638);
  const deckGeo = shared(new THREE.BoxGeometry(19, 0.35, 2.6)), deckInkGeo = shared(new THREE.BoxGeometry(19.3, 0.6, 2.9));
  const postGeo = shared(new THREE.CylinderGeometry(0.2, 0.2, 2.2, 6));
  const signBoardGeo = shared(new THREE.BoxGeometry(1, 1, 1));
  // Neighbour gates: a glowing ring at sea with the next developer's avatar.
  const gateRingGeo = shared(new THREE.TorusGeometry(4.6, 0.45, 10, 48));
  const gateRingInkGeo = shared(new THREE.TorusGeometry(4.6, 0.68, 10, 48));
  const gateDiscGeo = shared(new THREE.CircleGeometry(3.95, 48));
  const gatePillarGeo = shared(new THREE.CylinderGeometry(1.3, 1.3, 120, 16, 1, true));
  const gateBuoyGeo = shared(new THREE.CylinderGeometry(0.45, 0.6, 1.6, 10));
  const gateRingMat = sharedEnvMat(0x1e5e5c, 0x64dedb, { emissive: 0x1e8f8a, emissiveIntensity: 0.6 });
  const gateBuoyMat = sharedEnvMat(0x3a1c20, 0xe4574f);
  const gatePillarMat = shared(new THREE.MeshBasicMaterial({ color: 0x64dedb, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  const signPostGeo = shared(new THREE.CylinderGeometry(0.14, 0.17, 1, 6));
  const fenceMat = sharedEnvMat(0x2a2320, 0xf1e6cf);
  const fencePostGeo = shared(new THREE.BoxGeometry(0.22, 1.35, 0.22).translate(0, 0.55, 0));
  const fenceRailGeo = shared(new THREE.BoxGeometry(1, 0.13, 0.09));

  // Grazing animals: a few boxes and a woolly blob, instanced per part.
  const mergeGeos = (geos) => {
    const pos = [], nrm = [], idx = [];
    let off = 0;
    for (const g of geos) {
      pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array);
      for (const i of g.index.array) idx.push(i + off);
      off += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setIndex(idx);
    return shared(out);
  };
  const legsGeo = (w, l, h, t) => mergeGeos([[-1, -1], [-1, 1], [1, -1], [1, 1]]
    .map(([sx, sz]) => new THREE.BoxGeometry(t, h, t).translate(sx * l, h / 2 - 0.05, sz * w)));
  const ANIMALS = [
    { // sheep
      body: shared(new THREE.SphereGeometry(0.62, 12, 8).scale(1.3, 0.95, 1).translate(0, 0.95, 0)),
      bodyInk: shared(new THREE.SphereGeometry(0.62, 12, 8).scale(1.3 * 1.12, 0.95 * 1.16, 1.16).translate(0, 0.95, 0)),
      head: shared(new THREE.BoxGeometry(0.46, 0.42, 0.38).translate(0.2, 0, 0)),
      legs: legsGeo(0.28, 0.42, 0.62, 0.14),
      headAt: [0.78, 1.18], speed: 0.45, tintHead: false,
      bodyMat: sharedEnvMat(0x5a6378, 0xffffff), headMat: sharedEnvMat(0x0c0e14, 0x2c2a33), legMat: sharedEnvMat(0x0c0e14, 0x2c2a33),
      colors: [0xffffff, 0xf4efe4, 0xe9e2d4, 0xffffff],
    },
    { // cow
      body: shared(new THREE.BoxGeometry(1.7, 0.85, 0.85).translate(0, 1.05, 0)),
      bodyInk: shared(new THREE.BoxGeometry(1.92, 1.07, 1.07).translate(0, 1.05, 0)),
      head: shared(new THREE.BoxGeometry(0.55, 0.5, 0.5).translate(0.22, 0, 0)),
      legs: legsGeo(0.28, 0.62, 0.72, 0.18),
      headAt: [1.05, 1.35], speed: 0.35, tintHead: true,
      bodyMat: sharedEnvMat(0x5a6378, 0xffffff), headMat: sharedEnvMat(0x5a6378, 0xffffff), legMat: sharedEnvMat(0x0c0e14, 0x3a3030),
      colors: [0xf6f2ea, 0x9a6a45, 0x5b4033, 0xe8d8bf],
    },
  ];
  // Gulls: a shallow V that flaps by squashing its instance scale.
  const gullGeo = shared(new THREE.BufferGeometry());
  gullGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0.35, 0, 0, -0.25, 0, 0, 0.05, 0.3, -1.15,
    0.35, 0, 0, 0.05, 0.3, 1.15, -0.25, 0, 0,
  ], 3));
  gullGeo.computeVertexNormals();
  const gullMat = shared(new THREE.MeshBasicMaterial({ color: 0x1a2233, side: THREE.DoubleSide }));

  // Night lights: additive glow points for lamps and windows, and the
  // lighthouse's sweeping beam. They fade in as the day factor drops.
  const canvasTex = (w, h, paint) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.shared = true;
    return t;
  };
  const glowTex = canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.22, 'rgba(255,236,190,0.85)'); r.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
  const glowMats = [
    shared(new THREE.PointsMaterial({ map: glowTex, color: 0xffd68a, size: 4.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })),
    shared(new THREE.PointsMaterial({ map: glowTex, color: 0xffb057, size: 3.4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })),
  ];
  const beamTex = canvasTex(256, 32, (g) => {
    const lg = g.createLinearGradient(0, 0, 256, 0);
    lg.addColorStop(0, 'rgba(255,255,255,1)'); lg.addColorStop(0.35, 'rgba(255,255,255,0.45)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(0, 0, 256, 32);
    const vg = g.createLinearGradient(0, 0, 0, 32);
    vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(0.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = vg; g.fillRect(0, 0, 256, 32);
  });
  const beamMat = shared(new THREE.MeshBasicMaterial({ map: beamTex, color: 0xfff1c4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0, fog: false }));
  const beamGeo = shared(new THREE.PlaneGeometry(70, 6).translate(35, 0, 0)); // reaches out along +x from the lamp

  // Palms (tropical isles): curved trunk, drooping fronds and coconuts merged
  // into one vertex-coloured geometry, instanced; the crown sways in the shader.
  const PALM_TOP = new THREE.Vector3(1.5, 6.4, 0);
  const palmCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0.2, 3.4, 0), PALM_TOP);
  const palmGeo = (() => {
    const paint = (g, hex) => {
      const c = col(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const parts = [paint(new THREE.TubeGeometry(palmCurve, 10, 0.27, 7, false), 0xb07a45)];
    const leaf = new THREE.Shape();
    leaf.moveTo(0, 0); leaf.quadraticCurveTo(1.9, 0.78, 4.1, 0); leaf.quadraticCurveTo(1.9, -0.78, 0, 0);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.ShapeGeometry(leaf, 5);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      const lift = i % 3 === 0 ? 0.5 : 0.32; // a few fronds stand taller, the rest droop
      for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setY(k, lift * x - 0.15 * x * x); } // arch, then droop
      g.rotateY((i / 9) * TAU + (i % 2) * 0.18);
      g.translate(PALM_TOP.x, PALM_TOP.y, PALM_TOP.z);
      parts.push(paint(g, [0x3aa648, 0x4fc257, 0x2f9a45][i % 3]));
    }
    for (const [dx, dz] of [[0.25, 0.1], [-0.12, 0.24], [0.05, -0.26]]) {
      parts.push(paint(new THREE.SphereGeometry(0.22, 6, 5).translate(PALM_TOP.x + dx, PALM_TOP.y - 0.28, PALM_TOP.z + dz), 0x6b4a2a));
    }
    const pos = [], nrm = [], clr = [];
    for (const g0 of parts) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      g.computeVertexNormals();
      pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); clr.push(...g.attributes.color.array);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    return shared(out);
  })();
  const palmInkGeo = shared(new THREE.TubeGeometry(palmCurve, 10, 0.38, 7, false));
  const palmTime = { value: 0 };
  const palmMat = sharedEnvMat(0x1f2a24, 0xffffff, { vertexColors: true, side: THREE.DoubleSide });
  palmMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = palmTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float swayPh = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        float sway = smoothstep(4.5, 7.0, position.y) * (sin(uTime * 1.6 + swayPh) * 0.12 + sin(uTime * 2.7 + swayPh * 1.7) * 0.05);
        transformed.x += sway * (position.y - 4.5);
        transformed.z += sway * 0.6 * (position.y - 4.5);`);
  };

  // Sailboats: a pointed hull, mast, mainsail + jib and a teal pennant.
  const makeBoat = (() => {
    const hull = new THREE.Shape();
    hull.moveTo(-1.6, -0.62); hull.lineTo(0.7, -0.62);
    hull.quadraticCurveTo(1.7, -0.5, 2.05, 0); hull.quadraticCurveTo(1.7, 0.5, 0.7, 0.62);
    hull.lineTo(-1.6, 0.62); hull.closePath();
    const hullGeo = shared(new THREE.ExtrudeGeometry(hull, { depth: 0.75, bevelEnabled: false, curveSegments: 6 }));
    hullGeo.rotateX(-Math.PI / 2);
    hullGeo.translate(0, -0.35, 0);
    const inkGeo = shared(hullGeo.clone().translate(-0.2, -0.02, 0).scale(1.08, 1.2, 1.18).translate(0.2, 0, 0));
    const mastGeo = shared(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6).translate(0.1, 2.1, 0));
    const tri = (pts) => shared(new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))));
    const mainSail = tri([[-0.02, 0.65], [-0.02, 3.65], [-1.5, 0.65]]);
    const jib = tri([[0.22, 0.75], [0.22, 3.3], [1.75, 0.6]]);
    const flag = tri([[0.1, 3.8], [0.1, 3.4], [-0.6, 3.6]]);
    const sailMat = sharedEnvMat(0x39425a, 0xfdf8ec, { side: THREE.DoubleSide });
    const mastMat = sharedEnvMat(0x1a1410, 0x6b4a2e);
    const flagMat = sharedEnvMat(0x1e4d4b, 0x64dedb, { side: THREE.DoubleSide });
    const lineMat = shared(new THREE.LineBasicMaterial({ color: 0x0a0d16 }));
    const sailEdges = [shared(new THREE.EdgesGeometry(mainSail)), shared(new THREE.EdgesGeometry(jib))];
    const hullMats = [0xe4574f, 0xf4f1e8, 0x3d7cc9, 0xf2c14e, 0x5fb87a].map((c) => sharedEnvMat(0x1b2230, c));
    return (k) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(hullGeo, hullMats[k % hullMats.length]), new THREE.Mesh(inkGeo, inkMat), new THREE.Mesh(mastGeo, mastMat),
        new THREE.Mesh(mainSail, sailMat), new THREE.Mesh(jib, sailMat), new THREE.Mesh(flag, flagMat),
        ...sailEdges.map((e) => new THREE.LineSegments(e, lineMat)));
      g.rotation.order = 'YXZ';
      g.traverse((o) => { if (o.isMesh && o.material !== inkMat) o.castShadow = true; });
      return noRay(g);
    };
  })();

  // ---- the per-profile island -------------------------------------------------
  function buildLand(T, C, P = {}) {
    const B = BIOMES[T.biome] || BIOMES.meadow;
    const rnd = seededRandom(T.seed);
    const fbm = makeNoise((T.seed ^ 0x2F6B1D) | 0);
    const group = new THREE.Group();
    scene.add(group);
    const add = (...objs) => { for (const o of objs) group.add(noRay(o)); };
    const shadowSpots = [], bills = [], animated = [], boats = [];
    const glows = [[], []]; // xyz triplets: [lamps, windows]
    const landTints = [];   // per-island materials (signs) recoloured by setDay
    let disposed = false;

    // Coastline, and where things go.
    const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
    const wob = 0.75 + rnd() * 0.45; // how ragged the coast is
    const shoreR = (a) => ISLAND_R * (1 + wob * (0.10 * Math.sin(3 * a + ph[0]) + 0.06 * Math.sin(5 * a + ph[1]) + 0.03 * Math.sin(9 * a + ph[2])));
    const polar = (a, r) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    const coastAt = (x, z) => 1 - Math.hypot(x, z) / shoreR(Math.atan2(z, x));
    const inland = (a, back) => polar(a, Math.max(98, Math.min(128, shoreR(a) - back)));
    const sdSlab = C.sdf; // signed distance to the paved city block (any shape)
    const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const bearing = (from, to) => Math.atan2(to.z - from.z, to.x - from.x);

    // Villages evenly round the block; features go in the gaps between them.
    const rot = rnd() * TAU, nv = T.villages;
    const vb = Array.from({ length: nv }, (_, i) => rot + (i / nv) * TAU + (rnd() - 0.5) * 0.35);
    const gapB = vb.map((b, i) => (b + vb[(i + 1) % nv] + (i === nv - 1 ? TAU : 0)) / 2);
    const VILLAGES = vb.map((a) => ({ a, ...inland(a, 44), gaps: [] }));
    const FAIR = { a: gapB[nv - 1], ...inland(gapB[nv - 1], 40) };
    const LIGHT = (() => { const a = vb[0] - (nv >= 4 ? 0.4 : 0.55); return { a, ...polar(a, shoreR(a) * 0.975) }; })();
    const MILL = (() => { const a = vb[1] - 0.62; return { a, ...inland(a, 36) }; })();
    const HIGH = polar(gapB[0] - 0.22, Math.min(130, shoreR(gapB[0] - 0.22) - 34));
    const lakes = [];
    const lakeGaps = gapB.slice(0, Math.max(1, nv - 1));
    for (let k = 0; k < B.lakes; k++) {
      const g = lakeGaps[(k + (nv >= 3 ? 1 : 0)) % lakeGaps.length];
      const a = g + (k === 0 ? 0.12 : k % 2 ? -0.42 : 0.42);
      const r = k === 0 ? 92 : Math.min(shoreR(a) - 30, 110 + rnd() * 14);
      lakes.push({ ...polar(a, r), a, r: k === 0 ? 12 : 8 + rnd() * 3, river: B.river && k < 2 });
    }
    const RIVER_W = 3.2;
    const rivers = lakes.filter((l) => l.river).map((l) => {
      const pts = [], r0 = Math.hypot(l.x, l.z), end = shoreR(l.a) + 14, rp = rnd() * TAU;
      for (let k = 0, r = r0; r < end; k++, r = Math.min(end, r + 16)) {
        pts.push(polar(l.a + (k ? Math.sin(k * 1.9 + rp) * 0.07 : 0), r));
        if (r === end) break;
      }
      return smoothPath(pts, 2);
    });
    const plateaus = [
      ...VILLAGES.map((v) => ({ x: v.x, z: v.z, r: 40 })),
      { x: FAIR.x, z: FAIR.z, r: 26 },
      ...lakes.map((l) => ({ x: l.x, z: l.z, r: l.r + 12 })),
    ];
    const M = B.mound;
    const mounds = [
      { x: MILL.x, z: MILL.z, h: 8 * Math.min(M, 1.2), s: 11 },
      { x: HIGH.x, z: HIGH.z, h: 11 * M, s: 18 },
      { ...polar(gapB[0] - 0.5, Math.min(144, shoreR(gapB[0] - 0.5) - 26)), h: 7 * M, s: 12 },
      { ...polar(gapB[0] + 0.1, 110), h: 7 * M, s: 11 },
      { x: LIGHT.x, z: LIGHT.z, h: 3.4, s: 6, coastal: true },
    ];
    if (nv >= 4 && M > 1.2) mounds.push({ ...polar(gapB[2], 128), h: 9 * M, s: 15 });

    function smoothPath(ctrl, spacing = 1.4) {
      const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
      const n = Math.max(8, Math.round(curve.getLength() / spacing));
      return curve.getSpacedPoints(n).map((v) => ({ x: v.x, z: v.z }));
    }

    // Roads: leave the block at the middle of a side and wander out.
    const EXITS = C.exits.map((e) => ({ ...e, a: e.a ?? Math.atan2(e.z, e.x) }));
    const exitFor = (a) => EXITS.reduce((best, e) => (angDist(a, e.a) < angDist(a, best.a) ? e : best));
    function roadFromCity(target, wiggle) {
      const e = exitFor(Math.atan2(target.z, target.x));
      const a = { x: e.x + e.nx * 6, z: e.z + e.nz * 6 }, b = { x: e.x + e.nx * 16, z: e.z + e.nz * 16 };
      const dx = target.x - b.x, dz = target.z - b.z, L = Math.hypot(dx, dz) || 1;
      const m = { x: (b.x + target.x) / 2 - (dz / L) * wiggle, z: (b.z + target.z) / 2 + (dx / L) * wiggle };
      return smoothPath([{ x: e.x, z: e.z }, a, b, m, target]);
    }
    const roads = []; // { pts, w }
    VILLAGES.forEach((v) => {
      roads.push({ pts: roadFromCity(v, (rnd() - 0.5) * 26), w: 2.4 });
      v.gaps.push(Math.atan2(-v.z, -v.x));
    });
    roads.push({ pts: roadFromCity(polar(LIGHT.a + 0.07, shoreR(LIGHT.a + 0.07) * 0.9), (rnd() - 0.5) * 12), w: 2.4 });
    {
      const v = VILLAGES[nv - 1];
      const mid = { x: (v.x + FAIR.x) / 2 + (rnd() - 0.5) * 12, z: (v.z + FAIR.z) / 2 + (rnd() - 0.5) * 12 };
      roads.push({ pts: smoothPath([v, mid, FAIR]), w: 1.7 });
      v.gaps.push(bearing(v, mid));
      const r1 = roads[1].pts, from = r1[Math.floor(r1.length * 0.55)];
      const m2 = { x: (from.x + MILL.x) / 2 + 5, z: (from.z + MILL.z) / 2 + 5 };
      roads.push({ pts: smoothPath([from, m2, MILL]), w: 1.5 });
    }
    const roadDist = (x, z) => {
      let d = Infinity;
      for (const r of roads) d = Math.min(d, distToPolyline(x, z, r.pts) - r.w / 2);
      return d;
    };
    const riverDist = (x, z) => rivers.reduce((d, r) => Math.min(d, distToPolyline(x, z, r)), Infinity);

    // Attraction sites, reserved before the terrain so they get flattened.
    const keepOut = VILLAGES.map((v) => ({ x: v.x, z: v.z, r: 17 }));
    keepOut.push({ x: LIGHT.x, z: LIGHT.z, r: 7 }, { x: MILL.x, z: MILL.z, r: 7 }, { x: FAIR.x, z: FAIR.z, r: 11 });
    const sites = [];
    const siteFree = (x, z, r) => roadDist(x, z) > r + 1.5 && sdSlab(x, z) > r + 10
      && keepOut.every((k) => Math.hypot(x - k.x, z - k.z) > k.r + r)
      && lakes.every((l) => Math.hypot(x - l.x, z - l.z) > l.r + r + 6) && riverDist(x, z) > r + 6
      && sites.every((s) => Math.hypot(x - s.x, z - s.z) > s.r + r + 3);
    function reserve(tag, r, near, dmin, dmax, { flat = true, coast = false } = {}) {
      for (let t = 0; t < 50; t++) {
        const a = rnd() * TAU, d = dmin + rnd() * (dmax - dmin);
        const x = near.x + Math.cos(a) * d, z = near.z + Math.sin(a) * d;
        const c = coastAt(x, z);
        if (coast ? (c < 0.05 || c > 0.14) : c < 0.1 + r / ISLAND_R) continue;
        if (!siteFree(x, z, r)) continue;
        const s = { tag, x, z, r, rot: rnd() * TAU };
        sites.push(s);
        if (flat) plateaus.push({ x, z, r: r + 5 });
        return s;
      }
      return null;
    }
    const placeOf = {
      bigFair: [FAIR, 30, 46], fair: [FAIR, 16, 28], farm0: [VILLAGES[0], 30, 44], peak: [HIGH, 0, 8, { flat: false }],
      fair2: [FAIR, 16, 30], coast: [LIGHT, 10, 30, { coast: true }],
      slopes: [HIGH, 24, 50, { flat: false }], // room for a wind farm on the slopes
      wild: [HIGH, 26, 60],
    };
    for (let i = 1; i < nv; i++) placeOf[`farm${i}`] = [VILLAGES[i], 30, 44];
    const wish = (k) => { const { tag, r } = SITE_KINDS[k.replace(/\d+$/, '')]; const [near, dmin, dmax, o] = placeOf[k]; return reserve(tag, r, near, dmin, dmax, o); };
    const order = [...(T.fame >= 3 ? ['bigFair'] : []), 'fair', 'farm0', 'peak', 'fair2', 'coast', 'slopes', 'wild'];
    for (let i = 1; i < nv; i++) order.push(`farm${i}`);
    const wanted = T.landmarks || [];
    if (!wanted.length) order.slice(0, T.attractions).forEach(wish);
    else {
      // city.json landmarks first, each on the first free site that can hold it
      // (best effort), then the usual picks up to the fame-based count.
      const taken = new Set();
      for (const key of wanted) {
        const k = (LANDMARK_SITES[key] || []).find((c) => placeOf[c] && !taken.has(c));
        if (!k) continue;
        taken.add(k);
        const site = wish(k);
        if (site) site.want = key;
      }
      for (const k of order) {
        if (taken.size >= Math.max(T.attractions, wanted.length)) break;
        if (!taken.has(k)) { taken.add(k); wish(k); }
      }
    }

    // Launch pad (landmarks-4): a rocket and gantry a little inland from the
    // coast, on the islands of developers with some following. It draws from
    // its own random stream, so it doesn't shift the island's shared rnd() sequence.
    let PAD = null;
    if (T.fame >= PAD_FAME) {
      const pr = seededRandom((T.seed ^ 0x5eed) >>> 0);
      for (let t = 0; t < 80 && !PAD; t++) {
        const a = gapB[t % nv] + (pr() - 0.5) * 0.9;
        const r = shoreR(a) * (0.7 + pr() * 0.16);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (coastAt(x, z) >= 0.12 && siteFree(x, z, 7)) PAD = { a, x, z };
      }
      if (PAD) { keepOut.push({ x: PAD.x, z: PAD.z, r: 7 }); plateaus.push({ x: PAD.x, z: PAD.z, r: 9 }); }
    }

    // ---- height -------------------------------------------------------------
    const beachW = 0.06 * B.beach;
    function heightAt(x, z) {
      const coast = coastAt(x, z);
      if (coast < -0.25) return SEA_Y - 4;
      const dRiver = riverDist(x, z);
      const city = smooth(4, 30, sdSlab(x, z));
      let flat = city;
      for (const p of plateaus) flat = Math.min(flat, smooth(p.r * 0.7, p.r * 1.6, Math.hypot(x - p.x, z - p.z)));
      flat = Math.min(flat, smooth(RIVER_W + 2, RIVER_W + 16, dRiver));
      const inl = smooth(0.03, 0.2 + beachW, coast);
      let land = Math.max(0, fbm(x * 0.016, z * 0.016) - 0.42) * B.relief * flat * inl;
      let cliff = 0;
      for (const m of mounds) {
        const g = m.h * Math.exp(-((x - m.x) ** 2 + (z - m.z) ** 2) / (2 * m.s * m.s));
        if (m.coastal) cliff += g; else land += g * inl * city;
      }
      if (B.snow) {
        let mtn = 0;
        for (const m of mounds) if (!m.coastal) mtn += Math.exp(-((x - m.x) ** 2 + (z - m.z) ** 2) / (2 * (m.s * 1.3) ** 2));
        const n = fbm(x * 0.045 + 11, z * 0.045 - 5, 3);
        land += (1 - Math.abs(2 * n - 1)) ** 2 * 10 * Math.min(1, mtn) * inl * city;
      }
      // Beach: a small inked lip from the meadow down to sand, then under the waves.
      const sand = lerp(SEA_Y - 0.05, -0.5, smooth(-0.005, beachW, coast)) + Math.min(0, coast) * 45;
      let h = lerp(sand, GROUND + land, smooth(beachW - 0.002, beachW + 0.015, coast));
      h += cliff * smooth(-0.05, 0.03, coast);
      // Lakes and rivers: carve below the sea plane so the water shows through.
      let carve = smooth(RIVER_W + 3, RIVER_W - 1.2, dRiver);
      for (const l of lakes) carve = Math.max(carve, smooth(l.r + 5, l.r - 3, Math.hypot(x - l.x, z - l.z)));
      return lerp(h, SEA_Y - 1.4, carve);
    }
    const groundY = (x, z) => heightAt(x, z) - 0.05;
    const slopeAt = (x, z) => Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;

    // ---- ground mesh ----------------------------------------------------------
    const PAL = Object.fromEntries(Object.entries(B.pal).map(([k, v]) => [k, col(v)]));
    const SNOW = col(0xf3f6fb);
    const forestT = B.forestT - (T.forest - 1) * 0.08;
    const forestAt = (x, z) => fbm(x * 0.021 + 40, z * 0.021 - 13, 3)
      + 0.22 * Math.exp(-((x - HIGH.x) ** 2 + (z - HIGH.z) ** 2) / 3200)
      + lakes.reduce((s, l) => s + 0.12 * Math.exp(-((x - l.x) ** 2 + (z - l.z) ** 2) / 900), 0);
    const _c = new THREE.Color();
    // Vertex colour for the ground (the texture only carries tufts and flowers).
    // Returns how much of the grass detail texture should show.
    function groundColor(x, z, h, ny, out) {
      const band = smooth(0.46, 0.54, fbm(x * 0.03 + 7, z * 0.03 - 3, 3));
      out.copy(PAL.meadow).lerp(PAL.meadowLight, band);
      out.lerp(PAL.forest, smooth(forestT - 0.04, forestT + 0.04, forestAt(x, z)) * 0.8);
      out.lerp(PAL.highland, smooth(2.5, 10, h) * 0.7);
      // Snow caps get a crisp cel edge (not a soft fade, which reads as fog),
      // broken up by noise so the line looks drifted, not contoured.
      const snow = B.snow ? smooth(B.snow - 0.3, B.snow + 0.3, h + (fbm(x * 0.09, z * 0.09, 2) - 0.5) * 4) : 0;
      out.lerp(SNOW, snow);
      // Steep faces show bare rock, even through the snow (in hard-edged bands).
      const rock = snow > 0 ? smooth(0.9, 0.86, ny) : smooth(0.9, 0.76, ny);
      out.lerp(PAL.rock, rock);
      const sandy = smooth(-0.28, -0.52, h);
      out.lerp(_c.copy(PAL.sand).lerp(PAL.wetSand, smooth(-0.9, -1.22, h)), sandy);
      return (1 - sandy) * (1 - rock) * (1 - snow);
    }
    function groundMesh(cx, cz, size, seg, hFn) {
      const geo = new THREE.PlaneGeometry(size, size, seg, seg);
      geo.rotateX(-Math.PI / 2);
      geo.translate(cx, 0, cz);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, hFn(x, z));
        uv.setXY(i, x, z);
      }
      geo.computeVertexNormals();
      const nrm = geo.attributes.normal;
      const colors = new Float32Array(pos.count * 3), grass = new Float32Array(pos.count);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        grass[i] = groundColor(pos.getX(i), pos.getZ(i), pos.getY(i), nrm.getY(i), c);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('grass', new THREE.BufferAttribute(grass, 1));
      const mesh = new THREE.Mesh(geo, groundMat);
      mesh.receiveShadow = true;
      add(mesh);
      return mesh;
    }
    const island = groundMesh(0, 0, 440, 220, heightAt);

    // Shallow water and foam: flat bands that follow the coastline. Vertex
    // alpha fades them out to sea; the beach hides whatever lands under sand.
    function shoreBand(r0, r1, rgba0, rgba1, y, mat) {
      const N = 220;
      const pos = new Float32Array((N + 1) * 6), uvs = new Float32Array((N + 1) * 4), colr = new Float32Array((N + 1) * 8), idx = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU, R = shoreR(a), ca = Math.cos(a), sa = Math.sin(a);
        const ra = r0(R), rb = r1(R);
        pos.set([ca * ra, y, sa * ra, ca * rb, y, sa * rb], i * 6);
        uvs.set([ca * ra, -sa * ra, ca * rb, -sa * rb], i * 4); // same world UVs as the sea
        colr.set([...rgba0, ...rgba1], i * 8);
        if (i < N) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(colr, 4));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat);
      add(mesh);
      return mesh;
    }
    const sh = col(B.shallow);
    const bright = 1.35;
    shoreBand((R) => R * 0.97, (R) => R + 16 + 14 * B.beach, [sh.r * bright, sh.g * bright, sh.b * bright, 0.85], [sh.r, sh.g, sh.b, 0], SEA_Y + 0.02, shallowMat);
    const foam = shoreBand((R) => R * 0.99, (R) => R + 0.9, [1, 1, 1, 0.95], [1, 1, 1, 0.7], SEA_Y + 0.04, foamMat);
    const foam2 = shoreBand((R) => R + 3.4, (R) => R + 4.1, [1, 1, 1, 0.55], [1, 1, 1, 0.3], SEA_Y + 0.035, foam2Mat);

    // ---- roads, village squares, fields ----------------------------------------
    function ribbon(pts, width, lift, mat) {
      const pos = [], idx = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
        let tx = q.x - o.x, tz = q.z - o.z;
        const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
        for (const s of [-1, 1]) {
          const x = p.x - tz * s * width / 2, z = p.z + tx * s * width / 2;
          pos.push(x, heightAt(x, z) + lift, z);
        }
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      add(mesh);
    }
    function patch(x, z, r, lift, mat) {
      const geo = new THREE.CircleGeometry(r, 28);
      geo.rotateX(-Math.PI / 2);
      geo.translate(x, 0, z);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)) + lift);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      add(mesh);
    }
    for (const r of roads) { ribbon(r.pts, r.w + 0.7, 0.1, roadInk); ribbon(r.pts, r.w, 0.15, roadDirt); }
    for (const v of VILLAGES) { patch(v.x, v.z, 6.2, 0.1, roadInk); patch(v.x, v.z, 5.6, 0.15, roadDirt); }
    patch(FAIR.x, FAIR.z, 9.4, 0.1, roadInk); patch(FAIR.x, FAIR.z, 8.8, 0.15, roadDirt);
    for (const s of sites) keepOut.push({ x: s.x, z: s.z, r: s.r });

    function field(x, z, w, d, rot, kind) {
      const rr = Math.max(w, d) / 2 + 1.5;
      if (!keepOut.every((k) => Math.hypot(x - k.x, z - k.z) > k.r + rr * 0.6)) return;
      const geo = new THREE.PlaneGeometry(w, d, 8, 6);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(rot);
      geo.translate(x, 0, z);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)) + 0.12);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, fieldMats[kind]);
      mesh.receiveShadow = true;
      add(mesh);
      keepOut.push({ x, z, r: rr });
    }

    // ---- signs: welcome boards where the roads leave town, repo billboards in the country
    const signLit = (mat) => {
      const t = { mat, night: col(0x4a5570), day: col(0xffffff) };
      landTints.push(t);
      mat.color.copy(t.night).lerp(t.day, litNow);
      return mat;
    };
    const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${n}`);
    function signTexture(lines, w = 512, h = 256, bg = '#f7efd9') {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = bg; g.beginPath(); g.roundRect(8, 8, w - 16, h - 16, 24); g.fill();
      g.lineWidth = 12; g.strokeStyle = '#1a2233'; g.stroke();
      // Stack lines by their own ascent/descent so big and small lines never collide.
      const total = lines.reduce((sum, l) => sum + l.size * 1.22, 0);
      let y = (h - total) / 2;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      for (const l of lines) {
        let size = l.size;
        do { g.font = `${l.weight || 800} ${size}px ui-rounded, "Nunito", "Trebuchet MS", system-ui, sans-serif`; size -= 2; }
        while (g.measureText(l.text).width > w - 70 && size > 10);
        y += l.size * 0.92;
        g.fillStyle = l.color || '#1a2233';
        g.fillText(l.text, w / 2, y);
        y += l.size * 0.3;
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }
    function signboard(x, z, facing, w, h, lift, front, back) {
      const g = new THREE.Group();
      const y0 = heightAt(x, z);
      const board = new THREE.Mesh(signBoardGeo, woodMat);
      board.scale.set(w + 0.3, h + 0.3, 0.14);
      board.position.y = lift + h / 2;
      board.castShadow = true;
      const ink = new THREE.Mesh(signBoardGeo, inkMat);
      ink.scale.set(w + 0.5, h + 0.5, 0.3);
      ink.position.copy(board.position);
      g.add(board, ink);
      [[front, 0, 0.08], [back, Math.PI, -0.08]].forEach(([tex, yaw, dz]) => {
        const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), signLit(new THREE.MeshBasicMaterial({ map: tex })));
        face.rotation.y = yaw;
        face.position.set(0, lift + h / 2, dz);
        g.add(face);
      });
      const tall = lift + h * 0.6 + 1.5;
      for (const px of [-w * 0.38, w * 0.38]) {
        const pm = new THREE.Mesh(signPostGeo, postMat);
        pm.scale.set(1, tall, 1);
        pm.position.set(px, tall / 2 - 1.5, -0.16);
        pm.castShadow = true;
        g.add(pm);
      }
      g.position.set(x, y0, z);
      g.rotation.y = facing;
      add(g);
      keepOut.push({ x, z, r: w / 2 + 1 });
      glows[0].push(x, y0 + lift + h + 0.5, z); // a little lamp over the board at night
    }
    {
      // city.json (validated by city-config.js) can name the island, add a
      // welcome message, feature / hide repos and write billboard copy. The
      // text is free-form and only ever painted with fillText.
      const cfg = P.config || null;
      const who = P.user?.login || T.login;
      const whose = /s$/i.test(who) ? `${who}'` : `${who}'s`;
      const title = cfg?.island?.name || `${whose} city`;
      const hidden = new Set((cfg?.hide || []).map((n) => n.toLowerCase()));
      const repos = (P.repos || []).filter((r) => !r.fork && !hidden.has(String(r.name).toLowerCase()));
      const stars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
      const message = cfg?.welcome ? wrapWords(cfg.welcome, 30, 4) : null;
      const welcomeLines = [
        { text: 'WELCOME TO', size: 34, color: '#2f7f6b' },
        { text: title, size: 64 },
        ...(message
          ? message.map((text) => ({ text, size: 28, weight: 700, color: '#5a4a3a' }))
          : [{ text: `${B.label}${T.topLang ? ` · ${T.topLang}` : ''} · ★ ${fmt(stars)}`, size: 30, weight: 700, color: '#5a4a3a' }]),
      ];
      // A longer message makes a taller board; front and back share its height.
      const boardH = Math.max(256, Math.ceil(welcomeLines.reduce((sum, l) => sum + l.size * 1.22, 0) + 60));
      const welcome = signTexture(welcomeLines, 512, boardH);
      const farewell = signTexture([
        { text: 'YOU ARE LEAVING', size: 34, color: '#b0473a' },
        { text: title, size: 58 },
        { text: 'drive safe · come back soon', size: 28, weight: 700, color: '#5a4a3a' },
      ], 512, boardH);
      // Welcome boards a little way out of town; the back reads "you are leaving".
      const welcomed = [];
      for (const r of roads.slice(0, nv + 1)) {
        const i = Math.min(12, r.pts.length - 2), p = r.pts[i], q = r.pts[i + 1], o = r.pts[i - 1];
        const tx = q.x - o.x, tz = q.z - o.z, L = Math.hypot(tx, tz) || 1;
        const x = p.x - (tz / L) * (r.w / 2 + 2.4), z = p.z + (tx / L) * (r.w / 2 + 2.4);
        if (heightAt(x, z) < -0.3 || welcomed.some((q) => Math.hypot(q.x - x, q.z - z) < 9)) continue; // roads sharing an exit share a board
        welcomed.push({ x, z });
        signboard(x, z, Math.atan2(tx, tz), 4.6, 2.3 * boardH / 256, 1.6, welcome, farewell);
      }
      // Billboards out in the country advertise the top repos, one per road
      // (city.json "featured" first, in its order).
      const featured = (cfg?.featured || []).map((n) => n.toLowerCase());
      const rank = (r) => { const i = featured.indexOf(String(r.name).toLowerCase()); return i < 0 ? Infinity : i; };
      const top = [...repos].sort((a, b) => (rank(a) - rank(b)) || ((b.stargazers_count || 0) - (a.stargazers_count || 0)));
      roads.forEach((r, k) => {
        const repo = top[k];
        if (!repo || r.pts.length < 30) return;
        const i = Math.floor(r.pts.length * 0.62), p = r.pts[i], q = r.pts[i + 1], o = r.pts[i - 1];
        const tx = q.x - o.x, tz = q.z - o.z, L = Math.hypot(tx, tz) || 1, side = k % 2 ? 1 : -1;
        const x = p.x - (tz / L) * side * (r.w / 2 + 4.5), z = p.z + (tx / L) * side * (r.w / 2 + 4.5);
        if (heightAt(x, z) < -0.3 || slopeAt(x, z) > 0.3) return;
        const lines = [
          { text: repo.name, size: 62 },
          { text: `★ ${fmt(repo.stargazers_count || 0)}${repo.language ? ` · ${repo.language}` : ''}`, size: 34, weight: 700, color: '#2f7f6b' },
        ];
        const custom = cfg?.repos?.[repo.name]?.billboard; // city.json repos[name].billboard replaces the description
        const desc = (custom || repo.description || '').replace(/\s+/g, ' ').trim();
        if (desc) for (const l of wrapWords(desc, 38, custom ? 3 : 2)) lines.push({ text: l, size: 26, weight: 600, color: '#4a4a4a' });
        const tex = signTexture(lines, 768, 384, '#fffaf0');
        signboard(x, z, Math.atan2(-tx, -tz) + side * 0.5, 8.5, 4.25, 2.6, tex, tex);
      });
    }

    // ---- cutout batches ---------------------------------------------------------
    const batches = new Map(); // sprite name -> [{ x, y, z, h }]
    function plant(name, height, x, z, y, shadow = true) {
      const gy = y ?? groundY(x, z);
      if (!batches.has(name)) batches.set(name, []);
      batches.get(name).push({ x, y: gy, z, h: height });
      if (shadow && (y !== undefined || slopeAt(x, z) < 0.22)) shadowSpots.push({ x, y: gy + 0.1, z, w: height * 0.55 });
      if (name === `props-${PROP.LAMP}`) glows[0].push(x, gy + height * 0.9, z);
      else if (name.startsWith('houses-')) glows[1].push(x, gy + height * 0.32, z, x, gy + height * 0.55, z);
    }
    const pickOf = (kind, list) => `${kind}-${list[Math.floor(rnd() * list.length)]}`;
    const tree = () => pickOf('trees', B.trees);
    const bush = () => pickOf('bushes', B.bushes);
    const isFree = (x, z, road = 2.6) => sdSlab(x, z) > 9 && roadDist(x, z) > road
      && keepOut.every((k) => Math.hypot(x - k.x, z - k.z) > k.r) && heightAt(x, z) > -0.3;

    // A verge of bushes hugging the curb, then a ring of trees behind it.
    const along = (offset, n, fn) => {
      const path = C.outline(offset);
      for (let i = 0; i < n; i++) {
        const p = path.getPointAt(((i + rnd() * 0.4) / n) % 1);
        fn(p.x, p.y, i);
      }
    };
    along(3.2, 54, (x, z, i) => {
      if (i % 5 === 0 || roadDist(x, z) < 1.2) return;
      plant(pickOf('bushes', VERGE_BUSHES), 1.6 + rnd() * 1.2, x, z);
    });
    along(7.5, 40, (x, z) => { if (roadDist(x, z) > 2) plant(tree(), 5 + rnd() * 3.5, x, z); });
    // Street furniture on the sidewalk band just outside the boulevard.
    const furniture = [PROP.BENCH, PROP.HYDRANT, PROP.MAILBOX, PROP.BUS_STOP, PROP.TRASH_BIN, PROP.NEWS_STAND, PROP.BIKE_RACK, PROP.CART, PROP.BUS_SHELTER];
    along(-2.4, 30, (x, z, i) => {
      const kind = furniture[i % furniture.length];
      const h = kind === PROP.CART ? 2.6 : kind === PROP.BUS_STOP || kind === PROP.BUS_SHELTER ? 3.2 : kind === PROP.NEWS_STAND ? 2.2 : 1.3;
      plant(`props-${kind}`, h, x, z, 0.02, kind !== PROP.BUS_STOP && kind !== PROP.BUS_SHELTER);
    });
    // Lamps line the first stretch of each road out of town, then the odd bush.
    for (const r of roads.slice(0, nv + 1)) {
      r.pts.forEach((p, i) => {
        const q = r.pts[Math.min(i + 1, r.pts.length - 1)], o = r.pts[Math.max(i - 1, 0)];
        const L = Math.hypot(q.x - o.x, q.z - o.z) || 1, nx = -(q.z - o.z) / L, nz = (q.x - o.x) / L;
        const s = i % 2 ? 1 : -1;
        if (i > 3 && i < 40 && i % 7 === 0) plant(`props-${PROP.LAMP}`, 3.2, p.x + nx * s * 2.3, p.z + nz * s * 2.3, undefined, false);
        else if (i >= 40 && rnd() < 0.12) {
          const x = p.x + nx * s * (2.6 + rnd()), z = p.z + nz * s * (2.6 + rnd());
          if (heightAt(x, z) > -0.3) plant(bush(), 1.4 + rnd(), x, z);
        }
      });
    }

    // Villages: a ring of houses round a dirt square (gaps where roads come
    // in), lamps and a bench on the square, trees behind, fields beyond.
    VILLAGES.forEach((v, vi) => {
      const n = 9 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const a = v.gaps[0] + (i + 0.5) / n * TAU + (rnd() - 0.5) * 0.2;
        if (v.gaps.some((g) => angDist(a, g) < 0.42)) continue;
        const d = 8.5 + rnd() * 6;
        plant(pickOf('houses', [0, 1, 2, 3, 4, 5]), 5 + rnd() * 2.2, v.x + Math.cos(a) * d, v.z + Math.sin(a) * d);
      }
      const squareProps = [PROP.LAMP, PROP.BENCH, PROP.LAMP, PROP.MAILBOX, PROP.TRASH_BIN, PROP.BIKE_RACK, PROP.CART];
      squareProps.forEach((kind, i) => {
        const a = v.gaps[0] + 0.7 + i * (TAU / squareProps.length); // evenly round the square
        const h = kind === PROP.LAMP ? 3.2 : kind === PROP.CART ? 2.6 : 1.3;
        plant(`props-${kind}`, h, v.x + Math.cos(a) * 5.2, v.z + Math.sin(a) * 5.2, undefined, kind !== PROP.LAMP);
      });
      for (let i = 0; i < 9; i++) {
        const a = rnd() * TAU, d = 17 + rnd() * 6;
        const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
        if (roadDist(x, z) > 2 && heightAt(x, z) > -0.3 && keepOut.slice(nv).every((k) => Math.hypot(x - k.x, z - k.z) > k.r)) plant(tree(), 4.5 + rnd() * 3, x, z);
      }
      const away = v.gaps[0] + Math.PI;
      for (let i = 0; i < 5; i++) {
        const a = away + (i - 2) * 0.62 + (rnd() - 0.5) * 0.2;
        const d = 25 + rnd() * 6;
        const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
        if (coastAt(x, z) < 0.12 || roadDist(x, z) < 8) continue;
        field(x, z, 11 + rnd() * 4, 8 + rnd() * 3, -a + (rnd() - 0.5) * 0.5, (vi * 2 + i + (T.seed % 5)) % FIELD_KINDS.length);
      }
    });

    // Pastures: fenced paddocks beside the villages (gate facing home).
    const herds = [];
    VILLAGES.forEach((v) => {
      const away = v.gaps[0] + Math.PI;
      for (const side of [-1, 1]) {
        const a = away + side * (1.5 + rnd() * 0.35), d = 30 + rnd() * 7, r = 7 + rnd() * 2.5;
        const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
        if (coastAt(x, z) < 0.1 + r / ISLAND_R || roadDist(x, z) < r + 2 || riverDist(x, z) < r + 5 || slopeAt(x, z) > 0.12) continue;
        if (!keepOut.every((k) => Math.hypot(x - k.x, z - k.z) > k.r + r)) continue;
        herds.push({ x, z, r, kind: rnd() < 0.55 ? 0 : 1, gate: Math.atan2(v.z - z, v.x - x) });
        keepOut.push({ x, z, r: r + 1.2 });
      }
    });
    if (herds.length) {
      const posts = [], rails = [];
      for (const h of herds) {
        const n = Math.max(14, Math.round((TAU * h.r) / 2.1));
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const a = h.gate + 0.32 + (i / n) * (TAU - 0.64); // leave a gate toward the village
          const p = { x: h.x + Math.cos(a) * h.r, z: h.z + Math.sin(a) * h.r };
          p.y = heightAt(p.x, p.z);
          posts.push(p);
          if (prev) rails.push([prev, p]);
          prev = p;
        }
      }
      const postM = new THREE.InstancedMesh(fencePostGeo, fenceMat, posts.length);
      const railM = new THREE.InstancedMesh(fenceRailGeo, fenceMat, rails.length * 2);
      const d = new THREE.Object3D();
      posts.forEach((p, i) => { d.position.set(p.x, p.y, p.z); d.updateMatrix(); postM.setMatrixAt(i, d.matrix); });
      rails.forEach(([a, b], i) => {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        for (const k of [0, 1]) {
          d.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + (k ? 0.95 : 0.5), (a.z + b.z) / 2);
          d.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), 0);
          d.scale.set(len + 0.1, 1, 1);
          d.updateMatrix();
          railM.setMatrixAt(i * 2 + k, d.matrix);
        }
      });
      postM.receiveShadow = railM.receiveShadow = true;
      add(postM, railM);
    }

    // Landmarks: lighthouse on its headland, windmill on its hill. The fair's Ferris
    // wheel is the 3D one built below (it turns), so it gets no cutout.
    const lighthouseCut = cutout(`landmarks-${LANDMARK.LIGHTHOUSE}`, 16, LIGHT.x, groundY(LIGHT.x, LIGHT.z), LIGHT.z, { parent: group, list: bills });
    cutout(`landmarks-${LANDMARK.WINDMILL}`, 15, MILL.x, groundY(MILL.x, MILL.z), MILL.z, { parent: group, list: bills });
    for (const p of [LIGHT, MILL, FAIR]) shadowSpots.push({ x: p.x, y: groundY(p.x, p.z) + 0.1, z: p.z, w: 6 });
    if (PAD) {
      cutout(`landmarks-${LANDMARK.ROCKET}`, 17, PAD.x, groundY(PAD.x, PAD.z), PAD.z, { parent: group, list: bills });
      shadowSpots.push({ x: PAD.x, y: groundY(PAD.x, PAD.z) + 0.1, z: PAD.z, w: 7 });
    }
    for (let i = 0; i < 6; i++) {
      const a = bearing(FAIR, VILLAGES[nv - 1]) + 0.9 + i * 0.85;
      const kind = i % 2 ? PROP.CART : PROP.LAMP;
      plant(`props-${kind}`, kind === PROP.CART ? 2.6 : 3.2, FAIR.x + Math.cos(a) * 10.5, FAIR.z + Math.sin(a) * 10.5, undefined, kind === PROP.CART);
    }

    // Scenery accents: a fountain by the fair, a little pier on the beach, and a
    // scatter of autumn trees, rock clusters and a bench in open ground. They draw
    // from their own random stream (like the launch pad), so they don't shift the
    // island's shared rnd() sequence.
    const ar = seededRandom((T.seed ^ 0xacce5) >>> 0);
    const accentFree = (x, z, r) => roadDist(x, z) > r && sdSlab(x, z) > r + 10
      && keepOut.every((k) => Math.hypot(x - k.x, z - k.z) > k.r) && heightAt(x, z) > -0.3 && slopeAt(x, z) < 0.2;
    // A fountain beside the fair: the Ferris wheel stands on its centre, the carts
    // and lamps ring it at 10.5, so the fountain goes in between.
    for (let i = 0; i < 12; i++) {
      const a = ar() * TAU, x = FAIR.x + Math.cos(a) * 6.5, z = FAIR.z + Math.sin(a) * 6.5;
      if (roadDist(x, z) > 2.5 && sites.every((s) => Math.hypot(x - s.x, z - s.z) > s.r + 2)) {
        plant('props-fountain', 3.4, x, z, groundY(x, z) + 0.05);
        break;
      }
    }
    // A pier stepping out over the shallow water, at the open beach.
    for (let i = 0; i < 72; i++) {
      const a = ar() * TAU, d = ISLAND_R * (0.72 + ar() * 0.12);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (coastAt(x, z) > 0.02 && coastAt(x, z) < 0.14 && roadDist(x, z) > 4 && isFree(x, z, 3)) {
        plant('props-dock', 3.6, x, z, groundY(x, z) + 0.02);
        break;
      }
    }
    // Autumn trees: warm canopies for the leafy biomes, sparse elsewhere.
    const autumnT = T.biome === 'alpine' ? 0.5 : 0.16;
    for (let i = 0; i < 90; i++) {
      const a = ar() * TAU, d = 20 + ar() * (ISLAND_R - 26);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (ar() > autumnT) continue;
      if (accentFree(x, z, 3.5) && coastAt(x, z) > 0.16) {
        plant('scenery-autumn-tree', 5.5 + ar() * 3, x, z);
        keepOut.push({ x, z, r: 2.4 });
      }
    }
    // Rock clusters: more where the terrain is rugged.
    const rockT = T.biome === 'alpine' ? 0.5 : T.biome === 'meadow' ? 0.18 : 0.3;
    for (let i = 0; i < 90; i++) {
      const a = ar() * TAU, d = 18 + ar() * (ISLAND_R - 24);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (ar() > rockT) continue;
      if (accentFree(x, z, 3) && slopeAt(x, z) > 0.05) {
        plant('scenery-rock-cluster', 2.6 + ar() * 2, x, z);
        keepOut.push({ x, z, r: 2.2 });
      }
    }
    // An extra bench on the open verge between the trees.
    for (let i = 0; i < 40; i++) {
      const a = ar() * TAU, d = 24 + ar() * (ISLAND_R - 30);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (ar() < 0.5 || !accentFree(x, z, 3) || coastAt(x, z) <= 0.14) continue;
      plant(`props-${PROP.BENCH}`, 1.6, x, z);
      break;
    }

    // Water's edge: weeping willows lean over the lakes (not on tropical or savanna
    // isles) and reeds fringe the lakes and rivers. Their own random stream too.
    const wr = seededRandom((T.seed ^ 0x3a7e5) >>> 0);
    const shore = (x, z) => { const h = heightAt(x, z); return h > -0.5 && h < 0.9 && sdSlab(x, z) > 12 && roadDist(x, z) > 2; };
    const willows = T.biome === 'savanna' || T.biome === 'tropical' ? 0 : T.biome === 'lakeland' ? 3 : 2;
    for (const l of lakes) {
      for (let i = 0, n = 0; i < 24 && n < willows; i++) {
        const a = wr() * TAU, d = l.r + 2.8 + wr() * 2.4, x = l.x + Math.cos(a) * d, z = l.z + Math.sin(a) * d;
        if (!isFree(x, z, 2.5) || heightAt(x, z) > 2.5) continue;
        plant(`trees-${TREE.WILLOW}`, 6 + wr() * 2.5, x, z);
        keepOut.push({ x, z, r: 2.8 });
        n++;
      }
      for (let i = 0, n = 0; i < 30 && n < 9; i++) {
        const a = wr() * TAU, d = l.r + 0.4 + wr() * 1.4, x = l.x + Math.cos(a) * d, z = l.z + Math.sin(a) * d;
        if (!shore(x, z)) continue;
        plant(`bushes-${BUSH.REEDS}`, 1.5 + wr() * 0.7, x, z, undefined, false);
        n++;
      }
    }
    for (const r of rivers) {
      for (let i = 2; i < r.length - 1; i += 3) {
        const p = r[i], q = r[i + 1], dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz) || 1, s = wr() < 0.5 ? -1 : 1;
        const off = RIVER_W / 2 + 0.6 + wr() * 0.8, x = p.x - (dz / L) * off * s, z = p.z + (dx / L) * off * s;
        if (wr() < 0.55 && shore(x, z)) plant(`bushes-${BUSH.REEDS}`, 1.4 + wr() * 0.6, x, z, undefined, false);
      }
    }

    const highRocks = [];
    // Woods and meadows: a jittered grid thinned by the forest mask, with the
    // odd lone tree and flowering bush out in the open.
    {
      const STEP = 4.3, N = Math.ceil((ISLAND_R * 1.25) / STEP);
      for (let gx = -N; gx <= N; gx++) {
        for (let gz = -N; gz <= N; gz++) {
          const x = gx * STEP + (rnd() - 0.5) * STEP * 0.9, z = gz * STEP + (rnd() - 0.5) * STEP * 0.9;
          const roll = rnd();
          if (coastAt(x, z) < beachW + 0.015) continue;
          const f = smooth(forestT - 0.03, forestT + 0.05, forestAt(x, z));
          if (B.snow) {
            const hh = heightAt(x, z);
            if (hh > B.snow - 1.2) { if (roll < 0.08) highRocks.push({ x, z, s: 0.8 + rnd() * 1.7 }); continue; }
          }
          if (roll < f * 0.78 || roll > 0.986) {
            if (isFree(x, z)) plant(tree(), (f > 0.5 ? 5.5 : 4.5) + rnd() * 3.5 * T.forest, x, z);
          } else if (roll > 0.955 && isFree(x, z, 2)) {
            plant(bush(), 1.4 + rnd() * 1.1, x, z);
          }
        }
      }
    }

    // Tropical isles: palms lean over the top of the beach.
    const palmSpots = [];
    for (let i = 0; B.palms && i < B.palms * 3 && palmSpots.length < B.palms; i++) {
      const a = rnd() * TAU, R = shoreR(a) * (1 - beachW - 0.02 - rnd() * 0.07);
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      if (coastAt(x, z) < beachW + 0.012 || !isFree(x, z, 2)) continue;
      palmSpots.push({ x, z, y: groundY(x, z), s: 0.8 + rnd() * 0.5, ry: a + Math.PI + (rnd() - 0.5) * 1.2 }); // crowns lean seaward
    }

    // ---- rocks -------------------------------------------------------------------
    const rockSpots = [];
    const rock = (x, z, s, y = heightAt(x, z)) => rockSpots.push({ x, y: y - s * 0.2, z, s, ry: rnd() * TAU, sq: 0.55 + rnd() * 0.3, shade: rnd() });
    for (const r of highRocks) rock(r.x, r.z, r.s);
    for (let i = 0; i < 12; i++) {
      const a = rnd() * TAU, d = 3 + rnd() * 7;
      const x = LIGHT.x + Math.cos(a) * d, z = LIGHT.z + Math.sin(a) * d;
      if (coastAt(x, z) < 0.04) rock(x, z, 0.8 + rnd() * 1.6);
    }
    for (let i = 0; i < 34; i++) {
      const a = rnd() * TAU, cluster = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < cluster; k++) {
        const r = shoreR(a) * (0.99 + rnd() * 0.035), aa = a + (rnd() - 0.5) * 0.02;
        const x = Math.cos(aa) * r, z = Math.sin(aa) * r;
        if (roadDist(x, z) > 3) rock(x, z, 0.6 + rnd() * 1.5);
      }
    }
    for (let i = 0; i < 16 * M; i++) {
      const a = rnd() * TAU, d = rnd() * 30;
      const x = HIGH.x + Math.cos(a) * d, z = HIGH.z + Math.sin(a) * d;
      if (isFree(x, z, 1.5)) rock(x, z, 0.8 + rnd() * 1.4);
    }

    // ---- islets --------------------------------------------------------------
    for (let i = 0, n = 5 + Math.floor(rnd() * 4); i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.5;
      const r = Math.min(355, shoreR(a) * 1.5 + rnd() * 90);
      const it = { ...polar(a, r), size: 6 + rnd() * 12, top: (0.8 + rnd() * 4) * Math.min(M, 1.3), ph: rnd() * TAU };
      const hFn = (x, z) => {
        const dx = x - it.x, dz = z - it.z, aa = Math.atan2(dz, dx);
        const R = it.size * (1 + 0.18 * Math.sin(3 * aa + it.ph) + 0.08 * Math.sin(5 * aa + 2 * it.ph));
        const t = Math.hypot(dx, dz) / R;
        const core = Math.max(0, 1 - t / 0.8);
        return lerp(SEA_Y - 1.8, -0.5, smooth(1.25, 0.95, t)) + 0.44 * smooth(0.86, 0.74, t) + it.top * core * core;
      };
      groundMesh(it.x, it.z, it.size * 2.9, Math.round(it.size * 2.4), hFn);
      for (let k = 0, trees = it.size > 9 ? Math.floor(it.size / 3) : 0; k < trees; k++) {
        const aa = rnd() * TAU, d = Math.sqrt(rnd()) * it.size * 0.5;
        const x = it.x + Math.cos(aa) * d, z = it.z + Math.sin(aa) * d;
        if (B.palms) palmSpots.push({ x, z, y: hFn(x, z) - 0.05, s: 0.7 + rnd() * 0.4, ry: rnd() * TAU });
        else plant(tree(), 4 + rnd() * 3, x, z, hFn(x, z) - 0.05);
      }
      if (it.size > 14) plant(pickOf('houses', [0, 1, 2]), 4.5, it.x, it.z, hFn(it.x, it.z) - 0.05);
      for (let k = 0, rocks = 2 + Math.floor(rnd() * 4); k < rocks; k++) {
        const aa = rnd() * TAU, d = it.size * (0.8 + rnd() * 0.35);
        const x = it.x + Math.cos(aa) * d, z = it.z + Math.sin(aa) * d;
        rock(x, z, 0.7 + rnd() * 1.6, hFn(x, z));
      }
    }
    {
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
      const ink = new THREE.InstancedMesh(rockGeo, inkMat, rockSpots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
      const greys = B.snow ? [col(0xb9bcc2), col(0x9ea2a9), col(0xd0d3d8)] : [col(0xc9c0ad), col(0xa9a191), col(0xd8d0bd)];
      rockSpots.forEach((r, i) => {
        q.setFromEuler(e.set((rnd() - 0.5) * 0.3, r.ry, (rnd() - 0.5) * 0.3));
        v.set(r.x, r.y, r.z);
        m.compose(v, q, s.set(r.s, r.s * r.sq, r.s * 0.9));
        rocks.setMatrixAt(i, m);
        rocks.setColorAt(i, greys[Math.floor(r.shade * greys.length)]);
        m.compose(v, q, s.set(r.s + 0.14, r.s * r.sq + 0.14, r.s * 0.9 + 0.14));
        ink.setMatrixAt(i, m);
      });
      rocks.receiveShadow = rocks.castShadow = true;
      add(rocks, ink);
    }

    if (palmSpots.length) {
      const palms = new THREE.InstancedMesh(palmGeo, palmMat, palmSpots.length);
      const ink = new THREE.InstancedMesh(palmInkGeo, inkMat, palmSpots.length);
      const d = new THREE.Object3D();
      palmSpots.forEach((p, i) => {
        d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.ry, 0); d.scale.setScalar(p.s); d.updateMatrix();
        palms.setMatrixAt(i, d.matrix); ink.setMatrixAt(i, d.matrix);
        shadowSpots.push({ x: p.x, y: p.y + 0.15, z: p.z, w: 3 * p.s });
      });
      palms.frustumCulled = ink.frustumCulled = false;
      palms.receiveShadow = palms.castShadow = true;
      add(palms, ink);
    }

    // ---- grazing herds -------------------------------------------------------------
    const wander = seededRandom((T.seed ^ 0xBEEF) >>> 0);
    const beasts = [];
    herds.forEach((h) => {
      for (let i = 0, n = 3 + Math.floor(rnd() * 4); i < n; i++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * (h.r - 1.8);
        const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d, y = heightAt(x, z);
        const cs = ANIMALS[h.kind].colors;
        beasts.push({ h, kind: h.kind, x, z, y, ty: y, hd: rnd() * TAU, tx: x, tz: z, wait: rnd() * 5, graze: 1, c: cs[Math.floor(rnd() * cs.length)] });
      }
    });
    const herdMeshes = ANIMALS.map((A, k) => {
      const list = beasts.filter((b) => b.kind === k);
      if (!list.length) return null;
      const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, list.length); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; return m; };
      const H = { A, list, body: mk(A.body, A.bodyMat), ink: mk(A.bodyInk, inkMat), head: mk(A.head, A.headMat), legs: mk(A.legs, A.legMat) };
      list.forEach((b, i) => { H.body.setColorAt(i, col(b.c)); if (A.tintHead) H.head.setColorAt(i, col(b.c)); });
      H.body.castShadow = H.head.castShadow = true;
      add(H.body, H.ink, H.head, H.legs);
      return H;
    }).filter(Boolean);
    const dmy = new THREE.Object3D();
    dmy.rotation.order = 'YXZ';
    function updateHerds(dt, elapsed) {
      for (const H of herdMeshes) {
        const A = H.A;
        H.list.forEach((b, i) => {
          if (b.wait > 0) {
            b.wait -= dt;
            b.graze = Math.min(1, b.graze + dt * 1.4);
            if (b.wait <= 0) { // done grazing: amble to a new spot in the paddock
              const a = wander() * TAU, d = Math.sqrt(wander()) * (b.h.r - 1.8);
              b.tx = b.h.x + Math.cos(a) * d; b.tz = b.h.z + Math.sin(a) * d; b.ty = heightAt(b.tx, b.tz);
            }
          } else {
            b.graze = Math.max(0, b.graze - dt * 2);
            const dx = b.tx - b.x, dz = b.tz - b.z, L = Math.hypot(dx, dz);
            if (L < 0.25) b.wait = 3 + wander() * 7;
            else {
              const want = Math.atan2(dz, dx);
              b.hd += Math.atan2(Math.sin(want - b.hd), Math.cos(want - b.hd)) * Math.min(1, dt * 2.5);
              const sp = Math.min(L, A.speed * dt);
              b.x += Math.cos(b.hd) * sp; b.z += Math.sin(b.hd) * sp;
              b.y += (b.ty - b.y) * Math.min(1, dt);
            }
          }
          const walking = b.wait > 0 ? 0 : 1;
          dmy.position.set(b.x, b.y + walking * Math.abs(Math.sin(elapsed * 7 + i)) * 0.06, b.z);
          dmy.rotation.set(0, -b.hd, 0);
          dmy.updateMatrix();
          H.body.setMatrixAt(i, dmy.matrix); H.ink.setMatrixAt(i, dmy.matrix);
          dmy.position.y = b.y; dmy.updateMatrix(); H.legs.setMatrixAt(i, dmy.matrix);
          const hx = A.headAt[0] + b.graze * 0.12, hy = A.headAt[1] - b.graze * 0.55 + (b.graze > 0.9 ? Math.sin(elapsed * 5 + i) * 0.03 : 0);
          dmy.position.set(b.x + Math.cos(b.hd) * hx, b.y + hy, b.z + Math.sin(b.hd) * hx);
          dmy.rotation.set(0, -b.hd, -b.graze * 0.7);
          dmy.updateMatrix();
          H.head.setMatrixAt(i, dmy.matrix);
        });
        H.body.instanceMatrix.needsUpdate = H.ink.instanceMatrix.needsUpdate = true;
        H.head.instanceMatrix.needsUpdate = H.legs.instanceMatrix.needsUpdate = true;
      }
    }

    // ---- gull flocks wheeling over the coast ------------------------------------------
    const gullList = [];
    for (let f = 0; f < 3; f++) {
      const a = rnd() * TAU, r = shoreR(a) * (0.85 + rnd() * 0.45);
      const flock = { cx: Math.cos(a) * r, cz: Math.sin(a) * r, R: 14 + rnd() * 18, y: 16 + rnd() * 12, dir: rnd() < 0.5 ? -1 : 1, ph: rnd() * TAU };
      for (let i = 0, n = 5 + Math.floor(rnd() * 4); i < n; i++) {
        gullList.push({ f: flock, da: (i - n / 2) * 0.1 + (rnd() - 0.5) * 0.05, dr: (rnd() - 0.5) * 5, dy: (rnd() - 0.5) * 2.5, ph: rnd() * TAU });
      }
    }
    const gulls = new THREE.InstancedMesh(gullGeo, gullMat, gullList.length);
    gulls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    gulls.frustumCulled = false;
    add(gulls);
    function updateGulls(elapsed) {
      gullList.forEach((g, i) => {
        const f = g.f, a = f.ph + f.dir * elapsed * (5 / f.R) + g.da, R = f.R + g.dr;
        dmy.position.set(f.cx + Math.cos(a) * R, f.y + g.dy + Math.sin(elapsed * 0.7 + g.ph) * 0.6, f.cz + Math.sin(a) * R);
        dmy.rotation.set(f.dir * 0.3, -(a + f.dir * Math.PI / 2), 0);
        dmy.scale.set(0.85, 0.85 * (0.25 + Math.sin(elapsed * 8 + g.ph) * 0.9), 0.85);
        dmy.updateMatrix();
        gulls.setMatrixAt(i, dmy.matrix);
      });
      dmy.scale.set(1, 1, 1);
      gulls.instanceMatrix.needsUpdate = true;
    }

    // ---- pier by the lighthouse ------------------------------------------------
    const pierA = LIGHT.a - 0.17;
    const pierRoot = polar(pierA, shoreR(pierA) * 0.975);
    {
      const g = new THREE.Group();
      const deck = new THREE.Mesh(deckGeo, woodMat);
      deck.position.set(9.5, -0.42, 0);
      const deckInk = new THREE.Mesh(deckInkGeo, inkMat);
      deckInk.position.copy(deck.position);
      g.add(deck, deckInk);
      for (let x = 3; x <= 18.5; x += 3.1) {
        for (const z of [-1.25, 1.25]) {
          const pm = new THREE.Mesh(postGeo, postMat);
          pm.position.set(x, -1.2, z);
          g.add(pm);
        }
      }
      g.position.set(pierRoot.x, 0, pierRoot.z);
      g.rotation.y = -pierA;
      add(g);
    }

    // ---- sailboats ---------------------------------------------------------------
    for (let i = 0; i < T.boats; i++) {
      const g = makeBoat(i);
      add(g);
      boats.push({ g, a: rnd() * TAU, lane: 3 + rnd() * 9, speed: (0.006 + rnd() * 0.006) * (i % 2 ? -1 : 1), ph: rnd() * TAU });
    }
    {
      const g = makeBoat(T.seed);
      g.position.set(pierRoot.x + Math.cos(pierA) * 14 + Math.cos(pierA + Math.PI / 2) * 3, SEA_Y + 0.15,
        pierRoot.z + Math.sin(pierA) * 14 + Math.sin(pierA + Math.PI / 2) * 3);
      g.rotation.y = -pierA;
      add(g);
      boats.push({ g, docked: true, ph: rnd() * TAU });
    }

    // ---- instanced cutouts: one mesh per sprite ------------------------------------
    for (const [name, list] of batches) {
      getTex(name).ready.then((entry) => {
        if (disposed) return;
        const mesh = new THREE.InstancedMesh(unitPlane, billboardMat(name), list.length);
        const m = new THREE.Matrix4();
        list.forEach((p, i) => { m.makeScale(p.h * entry.aspect, p.h, 1).setPosition(p.x, p.y, p.z); mesh.setMatrixAt(i, m); });
        mesh.frustumCulled = false; // vertices move in the shader
        add(mesh);
      });
    }
    {
      const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, shadowSpots.length);
      const m = new THREE.Matrix4();
      shadowSpots.forEach((s, i) => { m.makeScale(s.w, 1, s.w * 0.55).setPosition(s.x, s.y, s.z); shadows.setMatrixAt(i, m); });
      add(shadows);
    }
    glows.forEach((list, k) => {
      if (!list.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
      const pts = new THREE.Points(g, glowMats[k]);
      pts.frustumCulled = false;
      add(pts);
    });
    const beam = new THREE.Group();
    const arm = (yaw) => {
      const g = new THREE.Group();
      const flat = new THREE.Mesh(beamGeo, beamMat), up = new THREE.Mesh(beamGeo, beamMat);
      up.rotation.x = Math.PI / 2; // a cross section, so it reads from above and from the side
      g.add(flat, up);
      g.rotation.set(0, yaw, -0.05);
      return g;
    };
    beam.add(arm(0), arm(Math.PI));
    beam.position.set(LIGHT.x, groundY(LIGHT.x, LIGHT.z) + 13.2, LIGHT.z);
    add(beam);

    // ---- 3D attractions (lazy module) ------------------------------------------------
    attractionsMod.then((mod) => {
      if (disposed || !mod?.ATTRACTIONS) return;
      // The fair's Ferris wheel: it turns, and faces the city.
      if (mod.buildFerrisWheel) {
        try {
          const fw = mod.buildFerrisWheel({ THREE, envMat: sharedEnvMat, ink: inkMat, rnd: seededRandom((T.seed ^ fnv('ferrisWheel')) >>> 0) }, {});
          fw.group.position.set(FAIR.x, heightAt(FAIR.x, FAIR.z) - 0.03, FAIR.z);
          fw.group.rotation.y = Math.atan2(-FAIR.x, -FAIR.z);
          fw.group.traverse((o) => { if (o.isMesh && o.material !== inkMat && o.material?.side !== THREE.BackSide) o.castShadow = true; });
          add(fw.group);
          animated.push(fw);
        } catch (err) {
          console.warn('ferris wheel failed', err);
        }
      }
      const pickRnd = seededRandom((T.seed ^ 0xA77) >>> 0);
      const used = new Set(sites.map((s) => s.want).filter(Boolean)); // requested landmarks aren't drawn twice
      for (const s of sites) {
        let choice = s.want ? mod.ATTRACTIONS.find((a) => a.key === s.want) : null; // reserved for a city.json landmark
        if (!choice) {
          // Never an automatic 3D lighthouse: every island already has its cutout one.
          const fits = mod.ATTRACTIONS.filter((a) => a.key !== 'lighthouse' && (a.tags || []).includes(s.tag) && a.radius <= s.r + 1.5);
          let pool = s.r > 15 ? fits.filter((a) => a.radius > 12) : fits;
          if (!pool.length) pool = fits;
          const fresh = pool.filter((a) => !used.has(a.key));
          if (fresh.length) pool = fresh;
          if (!pool.length) continue;
          const total = pool.reduce((t, a) => t + (a.weight ?? 1), 0);
          let k = pickRnd() * total;
          choice = pool[pool.length - 1];
          for (const a of pool) { k -= a.weight ?? 1; if (k <= 0) { choice = a; break; } }
        }
        used.add(choice.key);
        if (choice.key === 'lighthouse') { lighthouseCut.visible = false; beam.visible = false; } // a requested 3D lighthouse replaces the cutout one
        try {
          const obj = choice.build({ THREE, envMat: sharedEnvMat, ink: inkMat, rnd: seededRandom((T.seed ^ fnv(choice.key)) >>> 0) }, {});
          obj.group.position.set(s.x, heightAt(s.x, s.z) - 0.03, s.z);
          obj.group.rotation.y = s.rot;
          // Spread-out attractions (the wind farm) list sub-groups to seat on the terrain one by one.
          if (obj.group.userData.snap?.length) {
            obj.group.updateMatrixWorld(true);
            const wp = new THREE.Vector3();
            for (const c of obj.group.userData.snap) { c.getWorldPosition(wp); c.position.y += heightAt(wp.x, wp.z) - wp.y - 0.03; }
          }
          obj.group.traverse((o) => { if (o.isMesh && o.material !== inkMat && o.material?.side !== THREE.BackSide) o.castShadow = true; });
          if (s.tag === 'fair') { patch(s.x, s.z, Math.min(s.r, obj.radius + 2) + 0.6, 0.1, roadInk); patch(s.x, s.z, Math.min(s.r, obj.radius + 2), 0.15, roadDirt); }
          add(obj.group);
          animated.push(obj);
        } catch (err) {
          console.warn('attraction failed', choice.key, err);
        }
      }
    });

    function update(dt, elapsed, cx, cz) {
      beam.rotation.y += dt * 0.7;
      palmTime.value = elapsed;
      beam.visible = beamMat.opacity > 0.01;
      const swell = Math.sin(elapsed * 0.9);
      foam.scale.setScalar(1 + swell * 0.0028);
      foamMat.opacity = 0.8 + 0.2 * swell;
      foam2.scale.setScalar(1.006 + Math.sin(elapsed * 0.9 - 1.4) * 0.006);
      foam2Mat.opacity = 0.55 + 0.45 * Math.sin(elapsed * 0.9 - 1.4);
      for (const b of boats) {
        const bob = Math.sin(elapsed * 1.4 + b.ph);
        if (b.docked) { b.g.position.y = SEA_Y + 0.15 + bob * 0.05; b.g.rotation.x = bob * 0.03; continue; }
        b.a += b.speed * dt;
        const R = shoreR(b.a) * 1.12 + b.lane, a2 = b.a + Math.sign(b.speed) * 0.01, R2 = shoreR(a2) * 1.12 + b.lane;
        const x = Math.cos(b.a) * R, z = Math.sin(b.a) * R;
        b.g.position.set(x, SEA_Y + 0.15 + bob * 0.08, z);
        b.g.rotation.set(Math.sin(elapsed * 1.1 + b.ph) * 0.06, -Math.atan2(Math.sin(a2) * R2 - z, Math.cos(a2) * R2 - x), bob * 0.03);
      }
      for (const o of animated) o.update?.(dt, elapsed);
      updateHerds(Math.min(dt, 0.1), elapsed);
      updateGates(elapsed);
      updateGulls(elapsed);
      for (const b of bills) b.rotation.y = Math.atan2(cx - b.position.x, cz - b.position.z);
    }
    function dispose() {
      disposed = true;
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
          if (m.userData.shared) continue;
          if (m.map && !m.map.userData.shared) m.map.dispose();
          m.dispose();
        }
        if (o.isInstancedMesh) o.dispose();
      });
    }
    // ---- neighbour gates: portals at sea to the next developer's island ------------
    // Up to six gates ring the island. Fly through a ring, or walk/drive onto
    // the beach below one, and the host morphs the world into that profile.
    const gates = [];
    const gateGroup = new THREE.Group();
    add(gateGroup);
    const gateOffset = ((T.seed % 997) / 997) * TAU;
    function avatarTexture(url, login) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      const paint = (img) => {
        g.clearRect(0, 0, 256, 256);
        g.save(); g.beginPath(); g.arc(128, 128, 118, 0, TAU); g.clip();
        if (img) g.drawImage(img, 10, 10, 236, 236);
        else {
          g.fillStyle = '#2b3a55'; g.fillRect(0, 0, 256, 256);
          g.fillStyle = '#64dedb'; g.font = '800 110px ui-rounded, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(login.slice(0, 2).toUpperCase(), 128, 136);
        }
        g.restore();
        g.lineWidth = 12; g.strokeStyle = '#1a2233'; g.beginPath(); g.arc(128, 128, 120, 0, TAU); g.stroke();
      };
      paint(null);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { paint(img); tex.needsUpdate = true; };
      img.src = url;
      return tex;
    }
    function makeGate(n) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(gateRingGeo, gateRingMat);
      const ringInk = new THREE.Mesh(gateRingInkGeo, inkMat);
      ring.position.y = ringInk.position.y = 6.2;
      const tex = avatarTexture(n.avatar, n.login);
      const faceMat = signLit(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
      const face = new THREE.Mesh(gateDiscGeo, faceMat);
      face.position.y = 6.2;
      const label = signTexture([{ text: `@${n.login}`, size: 62 }, { text: 'next island →', size: 32, weight: 700, color: '#2f7f6b' }], 512, 200);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.8), signLit(new THREE.MeshBasicMaterial({ map: label, side: THREE.DoubleSide })));
      plate.position.y = 13.4;
      const pillar = new THREE.Mesh(gatePillarGeo, gatePillarMat);
      pillar.position.y = 60;
      const buoys = [-5.6, 5.6].map((x) => { const b = new THREE.Mesh(gateBuoyGeo, gateBuoyMat); b.position.set(x, 0.4, 0); return b; });
      g.add(ring, ringInk, face, plate, pillar, ...buoys);
      return g;
    }
    function setNeighbors(list) {
      for (const gt of gates) {
        gateGroup.remove(gt.obj);
        gt.obj.traverse((o) => {
          if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
          if (o.material && !o.material.userData.shared) { o.material.map?.dispose(); o.material.dispose(); }
        });
      }
      gates.length = 0;
      const n = Math.min(6, list.length);
      list.slice(0, n).forEach((nb, k) => {
        let b = gateOffset + (k / n) * TAU;
        if (angDist(b, LIGHT.a) < 0.3) b += 0.35; // keep clear of the lighthouse pier
        const R = shoreR(b) * 1.32, x = Math.cos(b) * R, z = Math.sin(b) * R;
        // No visible portal: a neighbour is simply the direction you fly off the map in.
        const obj = new THREE.Group();
        gateGroup.add(obj);
        gates.push({ ...nb, bearing: b, x, y: SEA_Y + 6.2, z, obj });
      });
    }
    // Which neighbour (if any) a traveller at (x, y, z) is heading to. Only the
    // plane travels: fly past the edge of the map (radius EDGE) in any
    // direction and you reach whichever neighbour lies closest to that bearing.
    const EDGE = 320;
    function gateFor(x, y, z, mode) {
      if (mode !== 'fly' || !gates.length || Math.hypot(x, z) < EDGE) return null;
      const b = Math.atan2(z, x);
      return gates.reduce((best, g) => (angDist(b, g.bearing) < angDist(b, best.bearing) ? g : best));
    }
    // Where someone arriving from bearing `b` (on this island) should appear,
    // heading inland: out at sea for a plane, on the first dry, gentle ground
    // for a car or walker. `heading` is the XZ angle, atan2(dz, dx).
    function arrival(b, mode) {
      if (mode === 'fly') {
        const R = Math.min(shoreR(b) * 1.45, 280); // inside the travel edge (320)
        return { x: Math.cos(b) * R, y: 26, z: Math.sin(b) * R, heading: b + Math.PI };
      }
      for (let k = 0.09; k < 0.6; k += 0.01) {
        const R = shoreR(b) * (1 - k), x = Math.cos(b) * R, z = Math.sin(b) * R, h = heightAt(x, z);
        if (h > -0.3 && slopeAt(x, z) < 0.3 && keepOut.every((q) => Math.hypot(x - q.x, z - q.z) > q.r * 0.6)) return { x, y: h, z, heading: b + Math.PI };
      }
      return { x: Math.cos(b) * 70, y: GROUND, z: Math.sin(b) * 70, heading: b + Math.PI };
    }
    function updateGates(elapsed) {
      gatePillarMat.opacity = 0.14 + Math.sin(elapsed * 2) * 0.05 + (1 - litNow) * 0.25;
      for (const g of gates) g.obj.position.y = SEA_Y + Math.sin(elapsed * 0.9 + g.bearing * 3) * 0.18;
    }

    return { traits: T, biome: B, group, tints: landTints, roads, gates, setNeighbors, gateFor, arrival, island, heightAt, update, dispose, sites, herds, villages: VILLAGES, fair: FAIR, light: LIGHT, mill: MILL };
  }

  // The city block the island wraps around. The host can pass any shape to
  // setProfile(): sdf(x, z) is the signed distance to the paved block (< 0
  // inside), outline(offset) a closed THREE.Path offset outward from its curb,
  // exits the points where country roads leave it ({ x, z, nx, nz } with an
  // outward normal). Default: the classic rounded square.
  const squareCity = {
    sdf: (x, z) => {
      const h = slabHalf - slabRadius;
      const qx = Math.abs(x) - h, qz = Math.abs(z) - h;
      return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - slabRadius;
    },
    outline: (offset) => roundedRect(THREE, slabHalf + offset, slabRadius + offset, THREE.Path),
    exits: [0, 1, 2, 3].map((k) => {
      const a = k * Math.PI / 2;
      return { a, x: Math.cos(a) * (slabHalf + 0.3), z: Math.sin(a) * (slabHalf + 0.3), nx: Math.round(Math.cos(a)), nz: Math.round(Math.sin(a)) };
    }),
  };

  let land = null;
  let lastNeighbors = null; // { login, list } from setNeighbors, re-applied when the island is rebuilt
  // profile.config: a normalised city.json (city-config.js) or null.
  function setProfile(profile, city = squareCity) {
    const T = worldTraits(profile);
    const cfg = profile?.config || null;
    const isBiome = (b) => typeof b === 'string' && Object.prototype.hasOwnProperty.call(BIOMES, b);
    if (isBiome(cfg?.island?.biome)) T.biome = cfg.island.biome; // the developer's choice
    const q = new URLSearchParams(globalThis.location?.search || '');
    if (isBiome(q.get('biome'))) T.biome = q.get('biome'); // ?biome=alpine to preview a biome
    T.landmarks = (cfg?.landmarks || []).filter((k) => Object.prototype.hasOwnProperty.call(LANDMARK_SITES, k));
    // Only what the island itself shows: a volume change in the Customize preview doesn't rebuild it.
    T.configKey = cfg ? JSON.stringify([cfg.island?.name, cfg.welcome, T.landmarks, cfg.featured, cfg.hide,
      Object.keys(cfg.repos || {}).map((n) => [n, cfg.repos[n].billboard])]) : '';
    if (land && land.city === city && land.traits.login === T.login && land.traits.biome === T.biome && land.traits.attractions === T.attractions && land.traits.configKey === T.configKey) return land.traits;
    if (land) land.dispose();
    land = buildLand(T, city, profile);
    land.city = city;
    if (lastNeighbors?.login === T.login) land.setNeighbors(lastNeighbors.list); // an island rebuilt for a config change keeps its gates
    return T;
  }
  // If the host never hands us a profile, still show an island.
  setTimeout(() => { if (!land) setProfile({}); }, 4000);

  // ---- per-user decals: empty lots ------------------------------------------
  let lotGroup = null;
  function setLots(cells) {
    if (lotGroup) { scene.remove(lotGroup); lotGroup = null; }
    lotGroup = new THREE.Group();
    for (const c of cells) {
      const r = seededRandom(c.seed);
      if (r() > 0.6) continue; // leave some lots plain so the district stays airy
      const d = decal(`lots-${Math.floor(r() * SPRITE_COUNTS.lots)}`, CELL - streetW - 0.6); // an empty lot between its streets
      d.position.set(c.x, 0.035, c.z);
      d.rotation.y = Math.floor(r() * 4) * Math.PI / 2;
      lotGroup.add(d);
    }
    scene.add(lotGroup);
  }
  function roofDecal(k, size) { return decal(`roofs-${k % SPRITE_COUNTS.roofs}`, size); }

  // ---- per-frame -------------------------------------------------------------
  let cloudOpacity = 0.95;
  const MOON_FLOOR = 0.3;
  var litNow = 1; // last day/night mix, so freshly built island materials start in step
  function setDay(day) {
    const lit = day + (1 - day) * MOON_FLOOR; // moonlight keeps a share of the day colours
    litNow = lit;
    for (const t of tints) t.mat.color.copy(t.night).lerp(t.day, lit);
    if (land) for (const t of land.tints) t.mat.color.copy(t.night).lerp(t.day, lit);
    cloudOpacity = 0.55 + day * 0.4;
    const night = smooth(0.55, 0.12, day);
    glowMats[0].opacity = night;
    glowMats[1].opacity = night * 0.95;
    beamMat.opacity = night * 0.5;
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
    land?.update(dt, elapsed, cx, cz);
  }

  return {
    setDay, update, setLots, roofDecal, cutout, setProfile,
    // Neighbour travel (see neighbors.js). setNeighbors ignores a list for a
    // login that is no longer on screen, so a slow fetch can't mislabel gates.
    setNeighbors: (login, list) => {
      lastNeighbors = { login: String(login).toLowerCase(), list };
      if (land && land.traits.login === lastNeighbors.login) land.setNeighbors(list);
    },
    gateFor: (x, y, z, mode) => land?.gateFor(x, y, z, mode) ?? null,
    arrival: (bearing, mode) => land?.arrival(bearing, mode) ?? null,
    get gates() { return land?.gates ?? []; },
    heightAt: (x, z) => land?.heightAt(x, z) ?? GROUND,
    get traits() { return land?.traits ?? null; },
    islandRadius: ISLAND_R,
    _parts: { sea, hills, clouds, get land() { return land; } },
  };
}
