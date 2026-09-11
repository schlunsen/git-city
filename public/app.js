/*
 * Git City — render a GitHub profile as a 3D voxel metropolis.
 * Buildings = repos (height/footprint scale with stars, walls colored by language).
 * Central plaza holds an avatar monument; streets run between blocks; cars loop
 * the main boulevard; a 60s day/night cycle lights the windows.
 *
 * Vanilla JS + Three.js (ESM via import map). No build step.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  fetchEvents, contributionDays, buildHeatmapRing, buildSky, createPostPass, createCrtPass, buildDust,
} from './city-enhancements.js';
import {
  buildTimeline, paceTimeline, actorState, stepIndexAt, dailyHistogram, activityByRepo, dateParts,
} from './history.js';
import { createWorld, roundedRect, roundedRingGeometry } from './world.js';
import { createExplorer } from './explore.js'; // walk / drive / fly explore modes
import { fetchNeighbors } from './neighbors.js';
import { buildRepoSigns } from './repo-signs.js'; // repo names on every building (fascia + tower crowns) // portal gates to the next developer's island
import { buildWayfinding } from './wayfinding.js'; // repo-named street signs + the explore-mode name tag
import { fetchCityConfig, normalizeCityConfig, fetchBuildingConfig, normalizeBuildingConfig, mergeBuildingConfig } from './city-config.js'; // city.json / building.json (validated, data only)
import { paintGraffiti } from './graffiti.js'; // spray-painted wall text (building configs)
import { createCustomizer, showToast } from './customize.js'; // Customize panel: live preview + publish via GitHub's editor

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API = 'https://api.github.com';
const DEFAULT_USER = 'torvalds';
// Bundled sample profiles, used when GitHub rate-limits us (60 req/h unauthenticated)
// or when the page is opened with ?demo=1. Captured via `gh api`; see fixtures/.
const DEFAULT_DEVELOPERS = ['torvalds', 'gaearon', 'sindresorhus', 'tj', 'antfu', 'schlunsen'];
const FIXTURES = Object.fromEntries(DEFAULT_DEVELOPERS.map(u => [u, `./fixtures/${u}.json`]));
const MAX_BUILDINGS = 100;
const DAY_CYCLE_SECONDS = 60; // full day->night->day loop
// Companion visualiser: replays a repository's full commit history Gource-style.
const GOURCE_VIEW = 'https://schlunsen.github.io/gource-view/viewer.html';

// Voxel palette per language. Falls back to gray for unknown languages.
const LANG_COLORS = {
  typescript: 0x3178c6, javascript: 0xf1e05a, python: 0x3572A5,
  rust: 0xf74c00, go: 0x00add8, c: 0x8a8a99, 'c++': 0x9a73d0,
  'c#': 0x8a63d0, java: 0xe8722a, ruby: 0x8b3133, php: 0x8f949d,
  css: 0xe44fac, html: 0xe34c26, shell: 0x5f8b4b, swift: 0xf05138,
  kotlin: 0x7b52c7, dart: 0x0175c2, scala: 0xc22d40, vue: 0x41b883,
  svelte: 0xff3e00, r: 0x276dc3, matlab: 0xe07020, perl: 0x0298c3,
  'jupyter notebook': 0xd98328, openscad: 0x8a7a5a,
};
const FALLBACK_COLOR = 0x9aa2b4;

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let scene, camera, renderer, controls, clock;
let sun, moon, hemi, cityGroup, carGroup;
let buildingMeshes = [];   // { mesh, body, bodyMat, roofMat, windowMat, hull, beacon, repo }
let hovered = null, selected = null;
let dayFactor = 0;         // 0 = night, 1 = day (auto-cycles)
let dayMode = 'auto';      // 'auto' (local time) | 'day' | 'night' | 'cycle' (60s demo loop)
let autoAngle = 0;
let raycaster, pointerNDC;

// ---- Visual enhancement state --------------------------------------------
let skyDome = null;        // buildSky() handle (gradient dome + stars + sun/moon)
let postPass = null;       // createPostPass() handle (bloom / grade / grain)
let crtPass = null;        // createCrtPass() handle (old-TV look)
let fxOn = false;          // bloom/grade pass — off by default, the flat toon look reads better
let tvOn = false;          // old-television pass
let heatmapRing = null;    // InstancedMesh of contribution bricks
let lampGroup = null;      // streetlamps (neon at night)
let world = null;          // createWorld() handle: island, hills, cutouts, clouds, decals
let fountain = null;       // { group, water, droplets }
let pedestrians = null;    // { inst, data[] }
let weather = null;        // { points, mode }
let commitShuttles = null; // { pts, data[] }
let forkBeams = null;      // { group, beams[] }
let districtSigns = null;  // { group }
let windowPulse = [];      // { mat, phase, base } for "office party" windows
let currentLogin = DEFAULT_USER;
let cityVersion = 0;
let districtBaseplates = null;
let tour = { active: false, paused: false, t: 0, legs: null, leg: 0, card: null, stops: null, stop: 0 }; // showcase flight (see updateTour)
let weatherMode = 'clear'; // 'clear' | 'rain' | 'snow'
// city.json of the profile on screen: { login, found, error, warnings, published, config }.
// `config` is what the city shows: the published file, or a Customize draft
// while previewing (both normalizeCityConfig() output, or null).
let cityConfig = null;
let pinnedRepos = [];   // the profile's pinned repos, when a snapshot knows them (GraphQL needs a token)
let profileNow = null;     // { user, repos } on screen; the Customize preview rebuilds from it
let customizer = null;     // customize.js handle
const viewerLook = { dayMode: null, weather: null }; // the viewer's own choice while a city.json overrides it

// ---- Timeline / actor state (Gource-style playback) ------------------------
const ACCENT = 0x64dedb;
const KIND_COLORS = {
  push: '#64dedb', 'pull req': '#8c78ff', review: '#8c78ff', issue: '#3abeff', comment: '#3abeff',
  star: '#ffa03a', fork: '#ffa03a', release: '#ffa03a', create: '#ffa03a', public: '#ffa03a',
};
const TRAVEL = 0.55, ACT = 1.0; // seconds at 1x: flight to a building, beam on it
let dust = null;
const _tmpColor = new THREE.Color();
let actor = null;            // { group, sprite, halo, beam, beamMat, ring, ringMat, glowTex, idle, pos }
let timeline = null;         // { steps, duration, events, hist, first, last }
let play = { playing: false, t: 0, speed: 1, lastIndex: -1, autoplayTimer: null };
let flyover = true;          // slow idle orbit
let follow = true;           // orbit target drifts toward the actor while playing
let camGoal = null;          // { target, position } glide for focusRepo
let explorer = null;         // explore.js handle (walk / drive / fly); owns the camera while exploring
let wayfinding = null;       // wayfinding.js handle (street signs + name tag), rebuilt with the buildings
let swallowTap = false;      // set when a tap only dismissed the compact menu
let bursts = [];             // transient particle bursts at beamed buildings
const buildingByName = new Map();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

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
function toonMat(opts = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: getToonRamp(), ...opts });
}
let outlineMat = null;
function getOutlineMat() {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0d16, side: THREE.BackSide });
    outlineMat.userData.shared = true; // never disposed with a building
  }
  return outlineMat;
}
// Inverted hull: a back-face copy of the box grown by `t` world units. Invisible
// to the raycaster so it never steals hover/click from the body it wraps.
function outlineBox(w, h, d, t = 0.3) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w + t, h + t, d + t), getOutlineMat());
  m.raycast = () => {};
  return m;
}
// Decorative meshes (plaza, cars) opt out of picking with this no-op.
const noRaycast = () => {};
const TAU = Math.PI * 2;
function box(w, h, d, x = 0, y = 0, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}
// Inverted-hull copy of any part, scaled about its own centre so the ink rim
// is about t/2 thick on each side. Works for rounded and tapered shapes too.
function hullOf(g, t) {
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3()), s = g.boundingBox.getSize(new THREE.Vector3());
  return g.clone().translate(-c.x, -c.y, -c.z)
    .scale((s.x + t) / s.x, (s.y + t) / s.y, (s.z + t) / s.z).translate(c.x, c.y, c.z);
}
// Merge static parts into one geometry (one draw call). With `colored`, parts
// are [geometry, hex] pairs baked into a vertex colour attribute so a single
// vertexColors material paints them all. The result is flagged shared.
function mergeParts(parts, colored = false) {
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
function annulusGeo(rIn, rOut, h, seg = 36) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, 0, TAU, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, TAU, true);
  s.holes.push(hole);
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg }).rotateX(-Math.PI / 2);
}
const envPalette = []; // { mat, night, day } — recoloured every frame by applyDayFactor
function envMat(night, day, extra = {}) {
  const m = toonMat({ color: night, ...extra });
  envPalette.push({ mat: m, night: new THREE.Color(night), day: new THREE.Color(day) });
  return m;
}
let windowTex = null;
function getWindowTexture() {
  if (!windowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(16, 4); ctx.lineTo(48, 4); ctx.quadraticCurveTo(60, 4, 60, 16);
    ctx.lineTo(60, 48); ctx.quadraticCurveTo(60, 60, 48, 60);
    ctx.lineTo(16, 60); ctx.quadraticCurveTo(4, 60, 4, 48);
    ctx.lineTo(4, 16); ctx.quadraticCurveTo(4, 4, 16, 4);
    ctx.closePath(); ctx.fill();
    // Mullion cross: the wall shows through, so the pane reads as a window.
    ctx.clearRect(29, 4, 6, 56); ctx.clearRect(4, 29, 56, 6);
    windowTex = new THREE.CanvasTexture(c);
    windowTex.colorSpace = THREE.SRGBColorSpace;
    windowTex.userData.shared = true;
  }
  return windowTex;
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// mulberry32 — rooftop props are deterministic per repo so a city looks the
// same every time it is loaded.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new Error(remaining === '0'
      ? 'GitHub rate limit hit — wait a minute, then try again.'
      : 'GitHub API rate limit reached.');
  }
  if (res.status === 404) throw new Error('notfound');
  if (!res.ok) throw new Error(`GitHub API error ${res.status}.`);
  return res.json();
}

// Load a bundled sample profile. Event timestamps are shifted forward by the
// time elapsed since capture so the "last 90 days" timeline stays populated.
async function loadFixture(login) {
  const url = FIXTURES[login] || FIXTURES[DEFAULT_USER];
  const res = await fetch(url);
  if (!res.ok) throw new Error('No sample data available.');
  const fx = await res.json();
  const shift = Date.now() - new Date(fx.fetched_at).getTime();
  const events = (fx.events || []).map(e => ({ ...e, created_at: new Date(new Date(e.created_at).getTime() + shift).toISOString() }));
  return { user: fx.user, repos: fx.repos, events, fetchedAt: fx.fetched_at, pinned: Array.isArray(fx.pinned) ? fx.pinned : [],
    tzOffset: Number.isFinite(fx.tz_offset) ? fx.tz_offset : null };
}

async function loadUser(login) {
  setLoadStatus(`fetching @${login}…`);
  const user = await fetchJSON(`${API}/users/${encodeURIComponent(login)}`);
  setLoadStatus('fetching repositories…');
  let repos;
  try {
    repos = await fetchJSON(
      `${API}/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated`);
  } catch (e) {
    if (e.message === 'notfound') repos = [];
    else throw e;
  }
  return { user, repos };
}

// ---------------------------------------------------------------------------
// Visual enhancements
// ---------------------------------------------------------------------------

// Remove enhancement meshes that are re-created per user (ring, shuttles,
// fork beams, district signs). Scene-level ones (sky, lamps, trees, fountain,
// pedestrians, clouds, weather) persist.
function clearPerUserEnhancements() {
  for (const object of [heatmapRing, commitShuttles?.pts, forkBeams?.group, districtSigns?.group, districtBaseplates]) {
    if (object) { scene.remove(object); disposeObject(object); }
  }
  heatmapRing = commitShuttles = forkBeams = districtSigns = districtBaseplates = null;
}

function buildRingFromEvents(events) {
  if (heatmapRing) { scene.remove(heatmapRing); disposeObject(heatmapRing); }
  heatmapRing = buildHeatmapRing(THREE, scene, contributionDays(events, 90), { radius: 11, brick: 0.72 }).mesh;
}

// ---------------------------------------------------------------------------
// Layout math
// ---------------------------------------------------------------------------
const BLOCK = 11;    // cells per side of the building district
const CELL = 9;     // world units per cell
const QUAD = 3;     // 3x3 cells per language quadrant (9 cells)
const DISTRICT = BLOCK * CELL; // four quadrants -> total district size
const SLAB_HALF = DISTRICT / 2 + 7; // the paved block, sidewalk included
const SLAB_R = 15;                  // corner radius — the block melts into the island
const RING_R = (BLOCK / 2) * CELL;  // boulevard centreline half-size
const RING_CORNER = SLAB_R - (SLAB_HALF - RING_R); // concentric with the slab corners
const PLAZA_R = CELL * 1.7;         // central town square, kept clear of buildings

// ---------------------------------------------------------------------------
// City footprints. Every profile gets one (same login, same shape). A shape
// is a signed distance function in world units (< 0 inside) whose zero
// contour is the boulevard's centreline. That contour is polar ray-marched
// into a polygon (every shape is star-shaped from the plaza), then the exact
// distance to the polygon is baked on a grid: lanes, curbs, the slab edge and
// the island's verge are all iso-contours of that one field, so they stay
// concentric. A cell is active when a full-size building clears the boulevard.
// ---------------------------------------------------------------------------
const SIDEWALK = SLAB_HALF - RING_R; // boulevard centreline -> slab edge (7)
const LOT_HALF = 3;                  // largest building half-footprint (starsToFootprint tops out at 6)
const LOT_CLEAR = 1.4;               // footprint corners stay this far inside the boulevard centreline
const SHAPE_TAU = Math.PI * 2;
function sdRoundBox(x, z, hx, hz, r) {
  const qx = Math.abs(x) - hx + r, qz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}
function sminPoly(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; }
// { base, make(n, seed) -> { cols, rows, sdf } }. The grid is cols x rows cells
// (odd, so the plaza sits on the middle cell); n grows by 2 until all repos fit.
const CITY_SHAPES = {
  square: { base: 11, make: n => ({ cols: n, rows: n, sdf: (x, z) => sdRoundBox(x, z, n * CELL / 2, n * CELL / 2, RING_CORNER) }) },
  wide: { base: 11, make: n => ({ cols: n + 2, rows: n - 2, sdf: (x, z) => sdRoundBox(x, z, (n + 2) * CELL / 2, (n - 2) * CELL / 2, 11) }) },
  tall: { base: 11, make: n => ({ cols: n - 2, rows: n + 2, sdf: (x, z) => sdRoundBox(x, z, (n - 2) * CELL / 2, (n + 2) * CELL / 2, 11) }) },
  round: { base: 13, make: n => ({ cols: n, rows: n, sdf: (x, z) => Math.hypot(x, z) - (n * CELL / 2 + 1) }) },
  plus: { base: 13, make: n => { // a cross: the corner cells are gone, the inside corners filleted
    const L = n * CELL / 2, W = (n - 6) * CELL / 2;
    return { cols: n, rows: n, sdf: (x, z) => sminPoly(sdRoundBox(x, z, L, W, 9), sdRoundBox(x, z, W, L, 9), 16) };
  } },
  octagon: { base: 13, make: n => { // chamfered square with rounded corners
    const h = n * CELL / 2; // a regular octagon: the diagonal flats as far out as the straight ones
    return { cols: n, rows: n, sdf: (x, z) => -sminPoly(-sdRoundBox(x, z, h, h, 0), -((Math.abs(x) + Math.abs(z)) / Math.SQRT2 - h), 10) };
  } },
  blob: { base: 13, make: (n, seed) => { // an organic outline, its wobble seeded by the login
    let s = seed >>> 0;
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
    const R = n * CELL / 2, p = [rnd(), rnd(), rnd()].map(v => v * SHAPE_TAU), sq = 0.5 + rnd() * 0.6;
    const rAt = a => R * (1 + 0.07 * Math.sin(2 * a + p[0]) + 0.045 * Math.sin(3 * a + p[1]) + 0.02 * Math.sin(5 * a + p[2]))
      * (1 + 0.05 * sq * Math.cos(4 * a) ** 2);
    return { cols: n, rows: n, sdf: (x, z) => (Math.hypot(x, z) - rAt(Math.atan2(z, x))) * 0.9 };
  } },
};
const CITY_SHAPE_NAMES = ['square', 'wide', 'tall', 'round', 'plus', 'octagon', 'blob'];
// `seed` hashes the login (+ account year); a valid `override` (?city=round) wins.
function chooseCityShape(seed, override) {
  if (CITY_SHAPES[override]) return override;
  return CITY_SHAPE_NAMES[(seed >>> 0) % CITY_SHAPE_NAMES.length];
}

// Polar ray-march: per bearing, the first radius where f rises through `level`.
function polarContour(f, level, maxR, N = 360) {
  const pts = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * SHAPE_TAU, c = Math.cos(a), s = Math.sin(a);
    let lo = 0, hi = maxR;
    for (let r = 1.5; r < maxR; r += 1.5) { if (f(c * r, s * r) > level) { hi = r; break; } lo = r; }
    for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (f(c * m, s * m) > level) hi = m; else lo = m; }
    const r = (lo + hi) / 2;
    pts.push({ x: c * r, z: s * r });
  }
  return pts;
}

function buildCityLayout(shape, n, seed) {
  const def = CITY_SHAPES[shape].make(n, seed);
  const { cols, rows } = def, hx = (cols - 1) / 2, hz = (rows - 1) / 2;
  const reach = Math.hypot(cols, rows) * CELL / 2 + 12;
  // 1. The boulevard centreline as a polygon.
  const line = polarContour(def.sdf, 0, reach);
  const N = line.length, ax = new Float64Array(N), az = new Float64Array(N), ex = new Float64Array(N), ez = new Float64Array(N), il = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = line[i], q = line[(i + 1) % N];
    ax[i] = p.x; az[i] = p.z; ex[i] = q.x - p.x; ez[i] = q.z - p.z; il[i] = 1 / (ex[i] * ex[i] + ez[i] * ez[i]);
  }
  const rMax = Math.max(...line.map(p => Math.hypot(p.x, p.z)));
  const exact = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      const px = x - ax[i], pz = z - az[i];
      let t = (px * ex[i] + pz * ez[i]) * il[i];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ex[i] * t, dz = pz - ez[i] * t, d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    // Inside or out: compare with the polygon's radius on this bearing.
    const f = ((Math.atan2(z, x) / SHAPE_TAU) % 1 + 1) % 1 * N, k = Math.floor(f) % N;
    const p = line[k], q = line[(k + 1) % N], c = Math.cos(f / N * SHAPE_TAU), s = Math.sin(f / N * SHAPE_TAU);
    const qx = q.x - p.x, qz = q.z - p.z, r = (p.x * qz - p.z * qx) / (c * qz - s * qx);
    return Math.hypot(x, z) < r ? -Math.sqrt(best) : Math.sqrt(best);
  };
  // 2. Bake the field on a grid; bilinear lookups are cheap enough for the island's heightfield.
  const H = 1.5, G0 = -(rMax + SIDEWALK + 40), GN = Math.ceil(-2 * G0 / H) + 1;
  const field = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) field[j * GN + i] = exact(G0 + i * H, G0 + j * H);
  const dist = (x, z) => {
    const u = (x - G0) / H, v = (z - G0) / H;
    const cu = Math.min(Math.max(u, 0), GN - 1.001), cv = Math.min(Math.max(v, 0), GN - 1.001);
    const i = Math.floor(cu), j = Math.floor(cv), fu = cu - i, fv = cv - j, o = j * GN + i;
    const d = (field[o] * (1 - fu) + field[o + 1] * fu) * (1 - fv) + (field[o + GN] * (1 - fu) + field[o + GN + 1] * fu) * fv;
    return u === cu && v === cv ? d : d + Math.hypot((u - cu) * H, (v - cv) * H); // off the grid: keeps growing
  };
  const contours = new Map();
  const contour = (level, M = 360) => { // memoised; callers must not mutate the result
    const key = `${level}:${M}`;
    if (!contours.has(key)) contours.set(key, polarContour(dist, level, reach + Math.max(0, level) + 4, M));
    return contours.get(key);
  };
  // 3. Cells: active when a full-size footprint clears the boulevard; `lot`
  // when at least an empty-lot decal fits (the ragged edge of round shapes).
  const fits = (x, z, half, clear) => dist(x - half, z - half) <= -clear && dist(x + half, z - half) <= -clear
    && dist(x - half, z + half) <= -clear && dist(x + half, z + half) <= -clear;
  const cells = [];
  for (let gx = -hx; gx <= hx; gx++) for (let gz = -hz; gz <= hz; gz++) {
    const { x, z } = worldForCell(gx, gz);
    const plaza = Math.hypot(Math.max(0, Math.abs(x) - 3.2), Math.max(0, Math.abs(z) - 3.2)) <= CELL * 1.7;
    const active = fits(x, z, LOT_HALF, LOT_CLEAR);
    cells.push({ gx, gz, x, z, plaza, active, inside: plaza || active, lot: !plaza && (active || fits(x, z, 2.6, 2.2)) });
  }
  const byKey = new Map(cells.map(c => [`${c.gx},${c.gz}`, c]));
  const L = { shape, n, seed, cols, rows, hx, hz, cells, dist, contour, reach, rMax, cellAt: (gx, gz) => byKey.get(`${gx},${gz}`) };
  L.capacity = cells.filter(c => c.active && !c.plaza).length;
  L.streets = cityStreets(L);
  // 4. Country roads leave where the two central axes cross the slab edge.
  L.exits = [0, 1, 2, 3].map(k => {
    const a = k * Math.PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
    let lo = 0, hi = reach + SIDEWALK;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (dist(c * m, s * m) > SIDEWALK + 0.3) hi = m; else lo = m; }
    const x = c * lo, z = s * lo, e = 0.5;
    const gx = dist(x + e, z) - dist(x - e, z), gz = dist(x, z + e) - dist(x, z - e), gl = Math.hypot(gx, gz) || 1;
    return { a, x, z, nx: gx / gl, nz: gz / gl };
  });
  return L;
}

// Inner streets run on the cell boundaries wherever they border a cell inside
// the block, and reach out to meet the boulevard when it is close by (so a
// curved edge never leaves dead ends). Returns centrelines { x0, z0, x1, z1, vertical }.
function cityStreets(L) {
  const out = [];
  const reachOut = (px, pz, dx, dz) => { // how far to move an end (along d) onto the centreline
    if (L.dist(px, pz) >= 0) { // a cell corner past a steep curve: pull back instead
      for (let t = 0.25; t <= CELL / 2; t += 0.25) if (L.dist(px - dx * t, pz - dz * t) < 0) return -t;
      return 0;
    }
    for (let t = 0; t <= CELL * 1.5; t += 0.25) if (L.dist(px + dx * t, pz + dz * t) >= 0) return t;
    return 0;
  };
  for (const vertical of [true, false]) {
    const across = vertical ? L.hx : L.hz, along = vertical ? L.hz : L.hx;
    for (let i = -across; i < across; i++) {
      const p = (i + 0.5) * CELL;
      const inside = k => {
        const a = vertical ? L.cellAt(i, k) : L.cellAt(k, i), b = vertical ? L.cellAt(i + 1, k) : L.cellAt(k, i + 1);
        return !!((a && a.inside) || (b && b.inside));
      };
      for (let k = -along; k <= along; k++) {
        if (!inside(k)) continue;
        let e = k;
        while (e + 1 <= along && inside(e + 1)) e++;
        let t0 = (k - 0.5) * CELL, t1 = (e + 0.5) * CELL;
        t0 -= vertical ? reachOut(p, t0, 0, -1) : reachOut(t0, p, -1, 0);
        t1 += vertical ? reachOut(p, t1, 0, 1) : reachOut(t1, p, 1, 0);
        out.push(vertical ? { x0: p, z0: t0, x1: p, z1: t1, vertical } : { x0: t0, z0: p, x1: t1, z1: p, vertical });
        k = e;
      }
    }
  }
  return out;
}

const cityLayouts = new Map();
// The smallest size of `shape` that fits `need` buildings. Same inputs, same object.
function makeCityLayout(shape = 'square', need = 100, seed = 0) {
  const S = CITY_SHAPES[shape] ? shape : 'square';
  for (let n = CITY_SHAPES[S].base; ; n += 2) {
    const key = `${S}:${n}:${S === 'blob' ? seed >>> 0 : 0}`;
    let L = cityLayouts.get(key);
    if (!L) {
      L = buildCityLayout(S, n, seed);
      if (cityLayouts.size >= 12) cityLayouts.delete(cityLayouts.keys().next().value);
      cityLayouts.set(key, L);
    }
    if (L.capacity >= need || n >= CITY_SHAPES[S].base + 8) return L;
  }
}

// Language -> (name, district color). Shared by building palette + districts.
const LANG_META = {
  TypeScript: { name: 'TypeScript District', color: 0x3178c6 },
  Python:     { name: 'Python Quarter',      color: 0x3572a5 },
  JavaScript: { name: 'JavaScript Zone',     color: 0xf1e05a },
  Go:         { name: 'Go Harbor',           color: 0x00add8 },
  Rust:       { name: 'Rust Foundry',        color: 0xf74c00 },
  C:          { name: 'C Core',              color: 0x8a8a99 },
  'C++':      { name: 'C++ Heights',         color: 0x8f9bc0 },
  'C#':       { name: 'C# Plaza',            color: 0x8c47d1 },
  Ruby:       { name: 'Ruby Block',          color: 0x701516 },
  PHP:        { name: 'PHP Rows',            color: 0x777bb3 },
  Swift:      { name: 'Swift Park',          color: 0xf05138 },
  Kotlin:     { name: 'Kotlin Corner',       color: 0x7f52ff },
  Java:       { name: 'Java Flats',          color: 0xe76f00 },
  Shell:      { name: 'Shell Alley',         color: 0x89e051 },
  HTML:       { name: 'HTML Market',         color: 0xe34c26 },
  CSS:        { name: 'CSS Studio',          color: 0x563d7c },
  Vue:        { name: 'Vue Garden',          color: 0x41b883 },
  Dart:       { name: 'Dart Yard',           color: 0x00b4ab },
  Scala:      { name: 'Scala Ridge',         color: 0xc22d40 },
  Julia:      { name: 'Julia Lab',           color: 0xa270ba },
  Elixir:     { name: 'Elixir Court',        color: 0x6e4a7e },
  Zig:        { name: 'Zig Works',           color: 0xffc50f },
  Assembly:   { name: 'Assembly Vault',      color: 0x6e4a3e },
  'Jupyter Notebook': { name: 'Notebook Labs', color: 0xda5b0b },
};
const OTHER_META = { name: 'Innovation District', color: FALLBACK_COLOR };
function langMeta(lang) {
  const key = (lang || '').toLowerCase();
  const named = LANG_META[lang] || Object.entries(LANG_META).find(([name]) => name.toLowerCase() === key)?.[1] || OTHER_META;
  // Prefer the canonical building palette color when present.
  const color = LANG_COLORS[key] ?? named.color;
  return { name: named.name, color };
}

// Map a star count to a building height (log scale, so 100k-star repos tower
// over 0-star ones without dwarfing the whole district).
function starsToHeight(stars) {
  return 4 + Math.log10(stars + 1) * 6.5; // 4u..~40u
}
function starsToFootprint(stars) {
  const t = Math.min(1, Math.log10(stars + 1) / 6);
  return 3.6 + t * 2.4; // 3.6..6.0 world units, keeps blocks from touching
}

// The layout's building cells (active, off the plaza), ranked by ring distance
// from the plaza, then by a fixed zigzag for variety. Deterministic order so
// re-renders of the same data are stable.
function assignSlots(L) {
  return L.cells.filter(c => c.active && !c.plaza)
    .map(c => ({ gx: c.gx, gz: c.gz, dist: Math.max(Math.abs(c.gx), Math.abs(c.gz)) })) // chebyshev
    .sort((a, b) => a.dist !== b.dist ? a.dist - b.dist : (a.gx + a.gz) - (b.gx + b.gz));
}

// Cells are addressed from the plaza: (0, 0) is the middle cell.
function worldForCell(gx, gz) {
  return { x: gx * CELL, z: gz * CELL };
}

// ---------------------------------------------------------------------------
// Topic districts — cluster repos into language neighborhoods on four
// quadrants around the plaza. Tallest repos in each cluster sit nearest the
// plaza (innermost quadrant cells). This is what turns the city from a sorted
// list into a *planned city*.
// ---------------------------------------------------------------------------
const QUADRANTS = [
  { cx:  1, cz:  1 }, // NE (gx>=mid, gz>=mid)
  { cx: -1, cz:  1 }, // NW
  { cx:  1, cz: -1 }, // SE
  { cx: -1, cz: -1 }, // SW
];

// Group repos by language, then pack the dominant languages onto quadrants.
// Returns { byCell: Map<gx+','+gz, repo>, assignments: [{repo,gx,gz,district}] }.
// Only the layout's active cells are used; the plaza (with a building's half
// footprint) is always reserved.
function assignDistricts(ranked, L = makeCityLayout('square')) {
  const available = assignSlots(L);
  const clusters = new Map();
  for (const repo of ranked) {
    const key = (repo.language || 'other').toLowerCase();
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(repo);
  }
  const assignments = [], byCell = new Map();
  const ordered = [...clusters.entries()].sort((a, b) =>
    b[1].reduce((sum, r) => sum + r.stargazers_count, 0) - a[1].reduce((sum, r) => sum + r.stargazers_count, 0));
  ordered.forEach(([district, repos], index) => {
    const q = QUADRANTS[index % 4];
    const anchor = { gx: q.cx * 2, gz: q.cz * 2 };
    for (const repo of repos) {
      available.sort((a, b) =>
        Math.hypot(a.gx - anchor.gx, a.gz - anchor.gz) - Math.hypot(b.gx - anchor.gx, b.gz - anchor.gz));
      const cell = available.shift();
      if (!cell) break;
      assignments.push({ repo, gx: cell.gx, gz: cell.gz, district });
      byCell.set(`${cell.gx},${cell.gz}`, repo);
    }
  });
  return { byCell, assignments };
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
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
function initScene() {
  const canvas = document.getElementById('scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Phones: cap the pixel ratio (and the shadow map below) — the toon look doesn't need retina fill.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed from three.js
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b111a, 260, 900);

  // Gradient sky dome (custom GLSL) replaces the flat background color. The
  // dome owns the sky color + stars + sun/moon, so we keep scene.background
  // null and let the shader handle it.
  skyDome = buildSky(THREE, scene);

  // Far plane must reach the sky dome (r=1000) from the far side of the orbit
  // (maxDistance 360), or a black hole opens straight ahead when zoomed out.
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 2600);
  camera.position.set(58, 46, 62);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.minDistance = 24;
  controls.maxDistance = 360;
  controls.maxPolarAngle = Math.PI * 0.49; // don't go below the ground
  controls.target.set(0, 8, 0);

  // Pause the idle auto-rotate while the user is dragging.
  let idleTimer = null;
  controls.addEventListener('start', () => {
    if (tour.active) tour.paused = true; // look around; the tour picks up again when you let go
    if (tourResumeTimer) clearTimeout(tourResumeTimer);
    camGoal = null;
    cine = null;
    controls.autoRotate = false;
    if (idleTimer) clearTimeout(idleTimer);
  });
  controls.addEventListener('end', () => {
    if (tour.active && tour.paused) tourResumeTimer = setTimeout(() => { if (tour.active && tour.paused) tourJump(0); }, 2500);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!tour.active && flyover) controls.autoRotate = true; }, 4000);
  });

  clock = new THREE.Timer(); // advanced once per frame in animate()
  raycaster = new THREE.Raycaster();
  pointerNDC = new THREE.Vector2();

  // ---- Lights -------------------------------------------------------------
  hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a1410, 0.5);
  scene.add(hemi);

  // r186 SunLight: a directional sun with two cascaded shadow maps fitted to
  // the view, so shadows reach across the whole island (the old
  // DirectionalLight had a fixed 140-unit box around the city). No target:
  // it shines from its position toward the origin.
  sun = new SunLight(0xfff1d6, 1.3);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048); // per cascade
  sun.shadow.camera.far = coarse ? 260 : 420; // max shadow distance from the camera
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 2.5; // PCF blur keeps the soft shadow edges
  scene.add(sun);

  moon = new THREE.DirectionalLight(0x8aa2ff, 0.25);
  moon.position.set(-50, 70, -30);
  scene.add(moon);

  cityGroup = new THREE.Group();
  scene.add(cityGroup);
  carGroup = new THREE.Group();
  scene.add(carGroup);

  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (postPass) postPass.resize(window.innerWidth, window.innerHeight);
  if (crtPass) crtPass.resize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Static environment (ground, streets, plaza)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The paved block for the current city footprint (see makeCityLayout): slab +
// inked curb, the boulevard ring with its own curb, the inner streets clipped
// to the shape, lane dashes and the streetlamps. Rebuilt only when the
// footprint changes; the plaza in the middle never does.
// ---------------------------------------------------------------------------
let cityLayout = null;  // makeCityLayout() result for the loaded profile
let blockGroup = null;  // meshes built from cityLayout
let blockMats = null;   // env materials, made once (envPalette recolours them)

function getBlockMats() {
  if (!blockMats) {
    const keep = m => { m.userData.shared = true; return m; };
    blockMats = {
      slab: keep(envMat(0x1a2230, 0xe3dccb)),
      ink: keep(envMat(0x090c14, 0x2b3140)),
      street: keep(envMat(0x0e131c, 0x4a5468)),
      stripe: keep(envMat(0x8a6a30, 0xf5cf4f, { emissive: 0x2a1c08 })),
    };
  }
  return blockMats;
}
// A closed contour of { x, z } points as a Shape in the XY plane (y = -z), so
// rotateX(-PI/2) lays it flat the right way round.
function contourShape(pts) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z)));
  s.closePath();
  return s;
}
// Flat band between two iso-contours of the layout's distance field.
function contourBand(L, inner, outer) {
  const s = contourShape(L.contour(outer));
  s.holes.push(contourShape(L.contour(inner)));
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}
// Evenly spaced points (by arc length) around a closed contour.
function loopResample(pts, spacing) {
  const n = pts.length, cum = [0];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z)); }
  const total = cum[n], m = Math.max(8, Math.round(total / spacing)), out = [];
  for (let k = 0, i = 0; k < m; k++) {
    const s = (k / m) * total;
    while (cum[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % n], f = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
  }
  return out;
}
// A smooth closed loop through evenly spaced points (uniform Catmull-Rom).
// Points come back as Vector2(x, z), like the THREE.Path lanes it stands in for.
class LoopCurve extends THREE.Curve {
  constructor(pts) { super(); this.pts = pts; this.arcLengthDivisions = pts.length * 4; }
  getPoint(t, out = new THREE.Vector2()) {
    const P = this.pts, n = P.length, f = (((t % 1) + 1) % 1) * n, i = Math.floor(f), u = f - i, u2 = u * u, u3 = u2 * u;
    const a = P[(i + n - 1) % n], b = P[i % n], c = P[(i + 1) % n], d = P[(i + 2) % n];
    const cr = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
    return out.set(cr(a.x, b.x, c.x, d.x), cr(a.z, b.z, c.z, d.z));
  }
}
// Car lane `offset` units outside (+) or inside (-) the boulevard centreline.
function boulevardLane(L, offset) {
  L.lanes ??= new Map();
  if (!L.lanes.has(offset)) L.lanes.set(offset, new LoopCurve(loopResample(L.contour(offset), 1.5)));
  return L.lanes.get(offset);
}
// What world.js needs to wrap the island around this footprint. Built once per
// layout: the world caches by identity.
function cityDescriptor(L) {
  L.city ??= {
    sdf: (x, z) => L.dist(x, z) - SIDEWALK, // < 0 on the paved slab
    outline: offset => { // a fresh closed Path, `offset` units outward from the slab edge
      const path = new THREE.Path();
      L.contour(SIDEWALK + offset).forEach((p, i) => (i ? path.lineTo(p.x, p.z) : path.moveTo(p.x, p.z)));
      path.closePath();
      return path;
    },
    exits: L.exits,
  };
  return L.city;
}
// Pick the footprint for a profile: deterministic per login (and account
// year), big enough for every repo shown. ?city=round previews a shape.
const CITY_SHAPE_BY_PROFILE = true; // false: every city is square unless ?city= asks for a shape
function cityLayoutFor(user, repos) {
  const need = Math.max(1, rankRepos(repos).length); // repos hidden by city.json need no lot
  const seed = hashStr(`city-v1:${String(user?.login || '').toLowerCase()}:${String(user?.created_at || '').slice(0, 4)}`);
  const override = new URLSearchParams(location.search).get('city') || cfgNow()?.island.shape; // ?city= preview, then city.json
  const shape = CITY_SHAPE_BY_PROFILE ? chooseCityShape(seed, override) : chooseCityShape(seed, override || 'square');
  return makeCityLayout(shape, need, seed);
}
function setCityLayout(L) {
  if (L === cityLayout && blockGroup) return;
  cityLayout = L;
  cityDescriptor(L);
  buildBlock(L);
  buildStreetlamps(L);
}

function buildBlock(L) {
  if (blockGroup) { cityGroup.remove(blockGroup); disposeObject(blockGroup); }
  const M = getBlockMats(), group = new THREE.Group();
  const add = (geo, mat, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y; m.raycast = noRaycast;
    group.add(m);
    return m;
  };
  const merge = parts => { const g = mergeGeometries(parts); for (const p of parts) p.dispose(); return g; };
  // The slab (top face at y = 0) with a dark curb, so the block reads as one
  // inked shape sitting on the grass.
  const slab = level => new THREE.ExtrudeGeometry(contourShape(L.contour(level)), { depth: 0.6, bevelEnabled: false }).rotateX(-Math.PI / 2);
  add(slab(SIDEWALK), M.slab, -0.6).receiveShadow = true;
  add(slab(SIDEWALK + 0.6).scale(1, 0.5 / 0.6, 1), M.ink, -0.58);
  // The boulevard follows the outline, inked with its own curb; inner streets
  // run under its edges so every junction is covered.
  add(contourBand(L, -2.0, 2.0), M.ink, 0.07);
  add(contourBand(L, -1.6, 1.6), M.street, 0.085);
  const streets = [], dashes = [];
  const dash = (x, y, z, tx, tz) => dashes.push(new THREE.BoxGeometry(0.5, 0.06, 2.2).rotateY(Math.atan2(tx, tz)).translate(x, y, z));
  for (const s of L.streets) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    streets.push(new THREE.BoxGeometry(s.vertical ? 3.2 : len, 0.08, s.vertical ? len : 3.2).translate((s.x0 + s.x1) / 2, 0.04, (s.z0 + s.z1) / 2));
    // Lane dashes on the grid's 4.5-unit rhythm, clear of the plaza and the boulevard.
    const t0 = s.vertical ? s.z0 : s.x0, t1 = s.vertical ? s.z1 : s.x1, p = s.vertical ? s.x0 : s.z0;
    for (let t = Math.ceil((t0 - 2.25) / 4.5) * 4.5 + 2.25; t < t1; t += 4.5) {
      const x = s.vertical ? p : t, z = s.vertical ? t : p;
      if (Math.hypot(x, z) < PLAZA_R || L.dist(x, z) > -2) continue;
      dash(x, 0.09, z, s.vertical ? 0 : 1, s.vertical ? 1 : 0);
    }
  }
  // Boulevard dashes on the straight and gently curved runs, not the tight corners.
  const ring = loopResample(L.contour(0), 4.5);
  ring.forEach((b, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
    const turn = Math.abs(Math.atan2((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)));
    if (turn < 4.5 / 14) dash(b.x, 0.1, b.z, c.x - a.x, c.z - a.z);
  });
  add(merge(streets), M.street, 0);
  add(merge(dashes), M.stripe, 0);
  group.userData.layout = L;
  cityGroup.add(group);
  blockGroup = group;
}

function buildEnvironment() {
  // The ground itself (island, water, hills) is built by world.js. The paved
  // block (slab, boulevard, streets) follows each profile's footprint and is
  // laid by setCityLayout(); the classic square stands in until one loads.
  setCityLayout(makeCityLayout('square'));
  buildPlaza();
}

// ---------------------------------------------------------------------------
// Central plaza: a designed town square. Painted radial paving with compass
// walkways, a contribution track under the heatmap ring, a teal inlay, an
// inked kerb, tree planters, benches and lanterns on the rim, and a monument
// (octagonal steps rising out of the fountain pool, a plinth with the Git
// emblem, a tapered commit-history pillar, a floating glowing diamond). The
// avatar hovers above the diamond. Built once; nothing here is pickable.
// ---------------------------------------------------------------------------
const PLAZA_Y = 0.14;                                  // paving surface height
const POOL = { water: 3.9, rimIn: 6.5, rimOut: 7.2 };  // fountain pool radii
let plazaFx = null; // { finial, finialY, setGlow(glow) }

function buildPlaza() {
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

function updatePlaza(dt) {
  if (!plazaFx) return;
  plazaFx.finial.rotation.y += dt * 0.9;
  plazaFx.finial.position.y = plazaFx.finialY + Math.sin(clock.getElapsed() * 1.6) * 0.16;
}

// Benches on the plaza rim, two per tree planter, facing the monument (shared
// by buildPlaza and the people sitting on them). b = angle around the plaza.
function plazaBenchSpots() {
  const spots = [];
  for (let q = 0; q < 4; q++) for (const s of [-1, 1]) {
    const b = Math.PI / 4 + q * Math.PI / 2 + s * 0.19;
    spots.push({ b, x: Math.cos(b) * 13.8, z: Math.sin(b) * 13.8 });
  }
  return spots;
}

// ---------------------------------------------------------------------------
// Buildings (repos)
// ---------------------------------------------------------------------------
function buildCity(repos, user) {
  // Clear previous
  clearPerUserEnhancements();
  for (const b of buildingMeshes) {
    cityGroup.remove(b.mesh);
    disposeObject(b.mesh);
  }
  buildingMeshes = [];
  buildingByName.clear();
  windowPulse = [];
  hovered = null;
  closePanel();
  document.getElementById('tooltip').classList.remove('show');

  const ranked = rankRepos(repos); // city.json: hidden repos out, featured ones first (closest to the plaza)

  // A profile with no (or only forked/archived) repos still gets a city —
  // pad with one placeholder "town hall" so the layout math is defined.
  if (ranked.length === 0) {
    ranked.push({
      name: 'town-hall', description: 'A quiet town — no public repos yet.',
      stargazers_count: 0, forks_count: 0, watchers_count: 0,
      language: null, created_at: '', pushed_at: '', default_branch: 'main',
      size: 0, archived: false, fork: false, html_url: `https://github.com/${user.login}`,
    });
  }

  const L = cityLayout || makeCityLayout('square');
  const slots = assignDistricts(ranked, L);

  ranked.forEach((repo, i) => {
    const a = slots.assignments.find(x => x.repo === repo);
    if (!a) return;
    const { x, z } = worldForCell(a.gx, a.gz);
    const h = starsToHeight(repo.stargazers_count);
    const f = starsToFootprint(repo.stargazers_count);
    createBuilding(repo, x, z, h, f, repoColor(repo), buildingCfg(repo)); // language colour unless a building config says otherwise
  });

  decorateBuildings(L); // repo signs + street names
  buildDistrictSigns(THREE, slots.assignments);
  buildDistrictBaseplates(THREE, slots.assignments);

  // Vacant cells get a top-down decal (park, parking, court, site) so a small
  // profile still looks like a lived-in town instead of an empty grid.
  // The ragged edge of a curved footprint gets them too, wherever a decal fits.
  const used = new Set(slots.assignments.map(a => `${a.gx},${a.gz}`));
  const lots = [];
  for (const c of L.cells) {
    if (!c.lot || used.has(`${c.gx},${c.gz}`)) continue;
    // Seeded by corner-based cell coords, as before, so a square city keeps its lots.
    lots.push({ x: c.x, z: c.z, seed: hashStr(`${user.login}:${c.gx + L.hx},${c.gz + L.hz}`) });
  }
  world?.setLots(lots);

  buildAvatar(user);
  buildCars(user);
  return rankRepos(repos).sort((a, b) => b.stargazers_count - a.stargazers_count); // what's built, tallest first
}

function createBuilding(repo, x, z, h, f, color, bcfg = null) { // bcfg: building config (city.json repos[name] + building.json)
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

// ---------------------------------------------------------------------------
// Facade painting — each tier gets an albedo canvas (walls, frames, shopfront,
// awning) and an emissive canvas (which windows are lit) so night glow varies
// per window instead of every pane lighting identically.
// ---------------------------------------------------------------------------
const FACADE_PX = 22;   // texture pixels per world unit
const FLOOR_H = 2.6;    // world units per storey
const WIN_STYLES = ['square', 'arch', 'ribbon'];
const _hsl = { h: 0, s: 0, l: 0 };
function buildingPalette(hex) {
  new THREE.Color(hex).getHSL(_hsl);
  const grey = _hsl.s < 0.12;
  const sat = grey ? _hsl.s : THREE.MathUtils.clamp(_hsl.s, 0.4, 0.62);
  const lig = THREE.MathUtils.clamp(_hsl.l, 0.58, 0.7);
  return {
    wall: new THREE.Color().setHSL(_hsl.h, sat, lig),
    roof: new THREE.Color().setHSL(_hsl.h, Math.min(1, sat + 0.08), lig * 0.5),
    accent: new THREE.Color().setHSL((_hsl.h + 0.5) % 1, grey ? 0.5 : 0.7, 0.56),
  };
}
const hexCss = (c) => '#' + c.getHexString();
let facadeAniso = 0;
function paintFacade(rnd, pal, w, h, { ground = false, style = 'square', litProb = 0.65 } = {}) {
  const u = FACADE_PX;
  const cw = Math.max(24, Math.round(w * u)), ch = Math.max(24, Math.round(h * u));
  const alb = document.createElement('canvas'); alb.width = cw; alb.height = ch;
  const emi = document.createElement('canvas'); emi.width = cw; emi.height = ch;
  const a = alb.getContext('2d'), e = emi.getContext('2d');
  const wall = hexCss(pal.wall), accent = hexCss(pal.accent);
  a.fillStyle = wall; a.fillRect(0, 0, cw, ch);
  e.fillStyle = '#000'; e.fillRect(0, 0, cw, ch);
  const Y = (wy) => ch - wy * u; // world height → canvas row

  // Storey bands, edge pilasters and a cornice under the roof.
  const floors = Math.floor(h / FLOOR_H);
  a.fillStyle = 'rgba(0,0,0,0.10)';
  for (let fl = 1; fl <= floors; fl++) a.fillRect(0, Y(fl * FLOOR_H), cw, 2);
  const pil = Math.max(2, 0.18 * u);
  a.fillStyle = 'rgba(255,255,255,0.12)';
  a.fillRect(0, 0, pil, ch); a.fillRect(cw - pil, 0, pil, ch);
  a.fillStyle = 'rgba(255,255,255,0.16)'; a.fillRect(0, 0, cw, 0.3 * u);
  a.fillStyle = 'rgba(0,0,0,0.18)'; a.fillRect(0, 0.3 * u, cw, 2);

  const frame = 'rgba(0,0,0,0.38)', paneDark = '#26324c';
  const warmths = ['#ffd27a', '#ffe3a6', '#ffc46a', '#fff1c9', '#bfe0ff'];
  const pane = (x0, y0, pw, ph, lit, kind) => {
    a.fillStyle = paneDark; e.fillStyle = lit ? warmths[Math.floor(rnd() * warmths.length)] : '#000';
    if (kind === 'arch') {
      const r = pw / 2;
      for (const ctx of [a, e]) {
        ctx.beginPath(); ctx.moveTo(x0, y0 + ph); ctx.lineTo(x0, y0 + r);
        ctx.arc(x0 + r, y0 + r, r, Math.PI, 0); ctx.lineTo(x0 + pw, y0 + ph); ctx.closePath(); ctx.fill();
      }
      a.strokeStyle = frame; a.lineWidth = 2.5; a.stroke();
    } else {
      const rr = kind === 'ribbon' ? 3 : Math.min(6, pw * 0.22);
      for (const ctx of [a, e]) { roundRect(ctx, x0, y0, pw, ph, rr); ctx.fill(); }
      a.strokeStyle = frame; a.lineWidth = 2.5; roundRect(a, x0, y0, pw, ph, rr); a.stroke();
    }
    if (kind === 'square') { // mullion cross in the wall colour
      a.fillStyle = wall; e.fillStyle = '#000';
      for (const ctx of [a, e]) { ctx.fillRect(x0 + pw / 2 - 1.5, y0, 3, ph); ctx.fillRect(x0, y0 + ph / 2 - 1.5, pw, 3); }
    }
    if (lit && rnd() < 0.3) { // someone standing in a lit window
      e.fillStyle = 'rgba(0,0,0,0.6)';
      e.fillRect(x0 + pw * (0.3 + rnd() * 0.3), y0 + ph * 0.45, pw * 0.22, ph * 0.5);
    }
  };

  const cols = Math.max(1, Math.round(w / 1.55)), cellW = cw / cols;
  for (let fl = ground ? 1 : 0; fl < floors; fl++) {
    const base = fl * FLOOR_H;
    if (style === 'ribbon') {
      if (base + 1.75 > h - 0.35) break;
      const ph = 1.0 * u, y0 = Y(base + 1.75);
      pane(0.25 * u, y0, cw - 0.5 * u, ph, rnd() < litProb, 'ribbon');
      a.fillStyle = frame; e.fillStyle = '#000';
      for (let c = 1; c < cols; c++) { a.fillRect(c * cellW - 1, y0, 2, ph); e.fillRect(c * cellW - 1, y0, 2, ph); }
    } else {
      const pw = Math.min(cellW * 0.58, 1.0 * u), ph = (style === 'arch' ? 1.45 : 1.15) * u;
      if (base + 0.65 + ph / u > h - 0.35) break;
      for (let c = 0; c < cols; c++) {
        pane(c * cellW + (cellW - pw) / 2, Y(base + 0.65) - ph, pw, ph, rnd() < litProb, style);
      }
    }
  }

  if (ground) {
    // Darker plinth, a centred door with a lit fanlight, shop windows and a
    // striped scalloped awning.
    a.fillStyle = 'rgba(0,0,0,0.20)'; a.fillRect(0, Y(FLOOR_H), cw, FLOOR_H * u);
    const doorW = 1.0 * u, doorH = 1.85 * u, dx = cw / 2 - doorW / 2, dy = ch - doorH;
    a.fillStyle = '#151b2a'; roundRect(a, dx, dy, doorW, doorH, 4); a.fill();
    a.strokeStyle = accent; a.lineWidth = 3; roundRect(a, dx, dy, doorW, doorH, 4); a.stroke();
    e.fillStyle = '#ffd9a0'; e.fillRect(dx + doorW * 0.2, dy + doorH * 0.12, doorW * 0.6, doorH * 0.28);
    const sw = dx - 0.55 * u, sh = 1.05 * u, sy = ch - 0.55 * u - sh;
    if (sw > 0.7 * u) {
      pane(0.3 * u, sy, sw, sh, true, 'ribbon');
      pane(dx + doorW + 0.25 * u, sy, sw, sh, true, 'ribbon');
    }
    const ay = Y(FLOOR_H + 0.05), ah = 0.42 * u, stripe = 0.5 * u, sc = 0.34 * u;
    a.fillStyle = accent; a.fillRect(0, ay, cw, ah);
    a.fillStyle = 'rgba(255,255,255,0.4)';
    for (let x0 = 0; x0 < cw; x0 += stripe * 2) a.fillRect(x0, ay, stripe, ah);
    a.fillStyle = accent;
    for (let x0 = sc / 2; x0 < cw; x0 += sc) { a.beginPath(); a.arc(x0, ay + ah, sc / 2, 0, Math.PI); a.fill(); }
  }

  if (!facadeAniso) facadeAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  const map = new THREE.CanvasTexture(alb), emissiveMap = new THREE.CanvasTexture(emi);
  for (const t of [map, emissiveMap]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = facadeAniso; }
  return { map, emissiveMap };
}

// Billboard district-name signs at the outer edge of each language quadrant,
// plus a tinted baseplate under each quadrant's footprint. Both are recreated
// per user (cleared by clearPerUserEnhancements).
function buildDistrictSigns(THREE, assignments) {
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

function buildDistrictBaseplates(THREE, assignments) {
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
function quadrantOf(gx, gz) {
  const ex = gx >= 0 ? 1 : 0;
  const ez = gz >= 0 ? 1 : 0;
  return (ex && ez) ? 0 : (!ex && ez) ? 1 : (ex && !ez) ? 2 : 3;
}

// ---------------------------------------------------------------------------
// Avatar monument (user's face floating over the plaza)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Static scene enhancements (built once in main())
// ---------------------------------------------------------------------------

// Streetlamps along the main boulevard with emissive cones that read as neon
// light pools at night.
function buildStreetlamps(L = cityLayout || makeCityLayout('square')) {
  if (lampGroup) { scene.remove(lampGroup); disposeObject(lampGroup); } // rebuilt with the footprint
  lampGroup = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6);
  const poleMat = toonMat({ color: 0x2a2f3a });
  const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
  const coneGeo = new THREE.ConeGeometry(1.1, 2.6, 20, 1, true);
  const headMat = toonMat({ color: 0x1a1a1a, emissive: 0xffd9a0, emissiveIntensity: 0.1 });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffe4b0, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
  // Two rows along the east-west avenue, out to the sidewalk just past the
  // boulevard on each side (4 units beyond its centreline), whatever the footprint.
  const rowEnd = (z, s) => { let x = 0; while (x < 200 && L.dist(s * x, z) < 4) x += 0.25; return s * x; };
  for (const z of [7.2, -7.2]) {
    const x0 = rowEnd(z, -1), x1 = rowEnd(z, 1);
    for (let i = 0; i <= 8; i++) {
      const x = x0 + (i / 8) * (x1 - x0);
      if (Math.hypot(x, z) < PLAZA_R + 1.5) continue; // the plaza has its own lanterns
      if (Math.abs(L.dist(x, z)) < 2.4) continue;    // never on the boulevard
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 1.6;
      const head = new THREE.Mesh(headGeo, headMat.clone()); head.position.y = 3.3;
      const cone = new THREE.Mesh(coneGeo, coneMat.clone()); cone.position.y = 2.1; cone.rotation.x = Math.PI;
      g.add(pole, head, cone);
      g.position.set(x, 0, z);
      g.userData.mat = head.material;
      g.userData.cone = cone.material;
      lampGroup.add(g);
    }
  }
  scene.add(lampGroup);
  // Store cone materials so applyDayFactor can fade them with the lamps.
  lampGroup.userData.cones = [];
  for (const l of lampGroup.children) lampGroup.userData.cones.push(l.userData.cone);
}

// Plaza fountain: a stone-rimmed pool around the monument's steps, cel-banded
// shader water with foam edges (teal underwater glow at night) and eight jets
// arcing from spouts on the rim toward the monument.
function buildFountain() {
  const g = new THREE.Group();
  const rimMat = envMat(0x3c465a, 0xe2d6bc);
  const rim = new THREE.Mesh(annulusGeo(POOL.rimIn, POOL.rimOut, 0.55, 48), rimMat);
  rim.position.y = PLAZA_Y;
  rim.castShadow = rim.receiveShadow = true;
  const rimHull = new THREE.Mesh(new THREE.CylinderGeometry(POOL.rimOut + 0.1, POOL.rimOut + 0.1, 0.72, 72), getOutlineMat());
  rimHull.position.y = PLAZA_Y + 0.26;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(POOL.rimIn, 0.045, 4, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a0d16 }));
  lip.position.y = PLAZA_Y + 0.55;
  const JETS = 8, PER = 18, N = JETS * PER, jetAng = j => (j + 0.5) * TAU / JETS; // between the footbridges
  const spouts = [];
  for (let j = 0; j < JETS; j++) spouts.push(box(0.3, 0.22, 0.3, Math.cos(jetAng(j)) * 6.85, PLAZA_Y + 0.66, Math.sin(jetAng(j)) * 6.85));
  const spoutMesh = new THREE.Mesh(mergeParts(spouts), rimMat);
  // Water: radial ripples quantised into cel bands, foam hugging the octagonal
  // steps and the rim. Colours are lerped for night by update().
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uGlow: { value: 0 }, uIn: { value: 4.16 }, uOut: { value: POOL.rimIn },
      uDeep: { value: new THREE.Color() }, uLight: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() },
    },
    vertexShader: `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime, uGlow, uIn, uOut; uniform vec3 uDeep, uLight, uFoam;
      varying vec2 vP;
      void main() {
        float r = length(vP), a = atan(vP.y, vP.x);
        vec2 q = abs(vP);
        float oct = max(max(q.x, q.y), (q.x + q.y) * 0.70710678); // distance to the octagonal steps
        float w = sin(r * 5.0 - uTime * 1.7) * 0.55 + sin(a * 11.0 + r * 1.5 + uTime * 0.8) * 0.3 + sin(a * 4.0 - uTime * 0.5) * 0.25;
        vec3 col = mix(uDeep, uLight, step(0.62, w) * 0.75 + step(0.05, w) * 0.25);
        float wob = sin(a * 24.0 + uTime * 2.2) * 0.04;
        float foam = clamp(step(oct - uIn, 0.16 + wob) + step(uOut - r, 0.14 + wob), 0.0, 1.0);
        col = mix(col, uFoam, foam * 0.9);
        col += uGlow * vec3(0.05, 0.42, 0.40) * (1.0 - smoothstep(0.0, 1.4, oct - uIn));
        gl_FragColor = vec4(col, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.RingGeometry(POOL.water, POOL.rimIn + 0.05, 96, 2), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = PLAZA_Y + 0.32;
  // Jets: droplets travelling along an arc from each spout.
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) seed[i] = Math.random();
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dropMat = new THREE.PointsMaterial({ color: 0xe6f8ff, size: 0.28, map: makeGlowTexture(32), transparent: true, depthWrite: false });
  const droplets = new THREE.Points(dg, dropMat);
  droplets.frustumCulled = false;
  g.add(rim, rimHull, lip, spoutMesh, water, droplets);
  g.traverse(o => { if (o.isMesh || o.isPoints) o.raycast = noRaycast; });
  scene.add(g);
  const u = waterMat.uniforms;
  const pal = {
    deep: [new THREE.Color(0x0f2c46), new THREE.Color(0x3a9bd6)], light: [new THREE.Color(0x1d6a82), new THREE.Color(0x8fe0f0)],
    foam: [new THREE.Color(0x7cc4d2), new THREE.Color(0xf4fcff)], drop: [new THREE.Color(0x9fe6ee), new THREE.Color(0xe6f8ff)],
  };
  fountain = {
    group: g,
    update(t, day) {
      u.uTime.value = t;
      u.uGlow.value = 1 - day;
      u.uDeep.value.copy(pal.deep[0]).lerp(pal.deep[1], day);
      u.uLight.value.copy(pal.light[0]).lerp(pal.light[1], day);
      u.uFoam.value.copy(pal.foam[0]).lerp(pal.foam[1], day);
      dropMat.color.copy(pal.drop[0]).lerp(pal.drop[1], day);
      for (let j = 0; j < JETS; j++) {
        const cx = Math.cos(jetAng(j)), cz = Math.sin(jetAng(j));
        for (let k = 0; k < PER; k++) {
          const i = j * PER + k, f = (t * 0.55 + k / PER + seed[i] * 0.05) % 1;
          const r = 6.75 - f * 2.1 + (seed[i] - 0.5) * 0.14;
          pos[i * 3] = cx * r;
          pos[i * 3 + 1] = PLAZA_Y + 0.72 + Math.sin(f * Math.PI) * 1.5 - f * 0.34;
          pos[i * 3 + 2] = cz * r;
        }
      }
      dg.attributes.position.needsUpdate = true;
    },
  };
}

// People: little cel-shaded townsfolk on the plaza. Walkers on two promenades
// (a couple with dogs on a lead), people resting on the benches and a group
// chatting on the rim. Each body part is one InstancedMesh with per-instance
// colours, so the whole crowd costs about a dozen draw calls.
const SKIN_TONES = [0xf5d0b0, 0xe8b48f, 0xc98d68, 0x8d5a3c, 0xf2c9a0, 0x6b4630];
const SHIRTS = [0xe8665a, 0x5aa7e8, 0x5fcf9a, 0xf2c14e, 0xa889e6, 0x64dedb, 0xf28cb8, 0xf39a4b, 0xf1ede4];
const PANTS = [0x2f3a5a, 0x4a6fa5, 0x6b4f3a, 0x3a3f4a, 0xb59f74];
const HAIR = [0x23201f, 0x5a3a22, 0xe0b458, 0xc0602c, 0xb9b9bd, 0x23201f, 0x5a3a22];
const COATS = [0xc98a4a, 0xf1ede4, 0x3a3230, 0x9a6b40];
const _pm = new THREE.Matrix4(), _pl = new THREE.Matrix4(), _pt = new THREE.Matrix4(), _pr = new THREE.Matrix4(), _pe = new THREE.Euler();

function buildPedestrians() {
  const rnd = seededRandom(20260911);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const people = [], dogs = [];
  const person = o => ({ skin: pick(SKIN_TONES), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), phase: rnd() * TAU, ...o });
  // Walkers: the inner promenade (pool to contribution track) runs one way,
  // the outer one (track to the rim furniture) the other.
  for (let i = 0; i < 20; i++) {
    const inner = i % 2 === 0, r = inner ? 7.9 + rnd() * 1.6 : 11.95 + rnd() * 0.5, v = 0.7 + rnd() * 0.35;
    people.push(person({ mode: 'walk', r, a: rnd() * TAU, w: (inner ? 1 : -1) * v / r, v, x: 0, z: 0, h: 0 }));
  }
  for (const owner of [people[2], people[7]]) dogs.push({ owner, coat: pick(COATS), phase: rnd() * TAU });
  // People resting on benches, facing the monument.
  const benches = plazaBenchSpots();
  for (const [bi, offsets] of [[0, [-0.36, 0.36]], [3, [0.1]], [5, [-0.2]], [6, [-0.36, 0.36]]]) {
    const { b, x, z } = benches[bi];
    for (const lx of offsets) people.push(person({
      mode: 'sit', y: PLAZA_Y + 0.11, h: Math.atan2(-Math.cos(b), -Math.sin(b)),
      x: x + lx * Math.sin(b) - 0.02 * Math.cos(b), z: z - lx * Math.cos(b) - 0.02 * Math.sin(b),
    }));
  }
  // A little group chatting on the open stretch of rim between a bench and a
  // lantern, with their dog sitting beside them.
  const ga = 1.2, gx = Math.cos(ga) * 14, gz = Math.sin(ga) * 14;
  for (let k = 0; k < 3; k++) {
    const th = 0.5 + k * TAU / 3;
    people.push(person({ mode: 'chat', x: gx + Math.cos(th) * 0.42, z: gz + Math.sin(th) * 0.42, h: Math.atan2(-Math.cos(th), -Math.sin(th)) }));
  }
  dogs.push({ owner: null, x: gx - Math.sin(ga) * 0.85, z: gz + Math.cos(ga) * 0.85, h: Math.atan2(Math.sin(ga), -Math.cos(ga)), coat: pick(COATS), phase: 0 });

  const N = people.length;
  const legGeo = box(0.12, 0.4, 0.14, 0, -0.2, 0);   // pivots at the hip
  const armGeo = box(0.09, 0.34, 0.1, 0, -0.17, 0);  // pivots at the shoulder
  const torsoGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.44, 8).translate(0, 0.62, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.19, 1).translate(0, 1.03, 0);
  const hairGeo = new THREE.SphereGeometry(0.205, 10, 5, 0, TAU, 0, Math.PI * 0.55).rotateX(-0.45).translate(0, 1.04, 0);
  const eyesGeo = mergeParts([box(0.035, 0.055, 0.03, 0.065, 1.02, 0.185), box(0.035, 0.055, 0.03, -0.065, 1.02, 0.185)]);
  const hullGeo = mergeParts([hullOf(torsoGeo, 0.07), hullOf(headGeo, 0.07)]);
  const cloth = toonMat({ color: 0xffffff }); // tinted per instance
  const inst = (geo, mat, count, cast = false) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = cast; m.frustumCulled = false; m.raycast = noRaycast;
    scene.add(m);
    return m;
  };
  const meshes = {
    legL: inst(legGeo, cloth, N, true), legR: inst(legGeo, cloth, N, true), armL: inst(armGeo, cloth, N), armR: inst(armGeo, cloth, N),
    torso: inst(torsoGeo, cloth, N, true), head: inst(headGeo, cloth, N, true), hair: inst(hairGeo, cloth, N),
    eyes: inst(eyesGeo, new THREE.MeshBasicMaterial({ color: 0x1a1d26 }), N), hull: inst(hullGeo, getOutlineMat(), N),
  };
  const col = new THREE.Color();
  people.forEach((p, i) => {
    for (const k of ['legL', 'legR']) meshes[k].setColorAt(i, col.setHex(p.pants));
    for (const k of ['armL', 'armR', 'torso']) meshes[k].setColorAt(i, col.setHex(p.shirt));
    meshes.head.setColorAt(i, col.setHex(p.skin));
    meshes.hair.setColorAt(i, col.setHex(p.hair));
  });

  // Dogs: one merged, vertex-coloured model tinted per instance by its coat.
  const dogBody = box(0.2, 0.18, 0.42, 0, 0.25, 0), dogHead = box(0.19, 0.18, 0.19, 0, 0.4, 0.25);
  const dogHull = mergeParts([hullOf(dogBody, 0.07), hullOf(dogHead, 0.07)]);
  const dogParts = [[dogBody, 0xffffff], [dogHead, 0xffffff],
    [box(0.1, 0.08, 0.1, 0, 0.36, 0.38), 0xd8d0c4],                                     // snout
    [box(0.05, 0.04, 0.03, 0, 0.39, 0.435), 0x1a1d26],                                   // nose
    [box(0.05, 0.1, 0.07, 0.075, 0.5, 0.22), 0x8a7a6a], [box(0.05, 0.1, 0.07, -0.075, 0.5, 0.22), 0x8a7a6a], // ears
    [box(0.03, 0.04, 0.02, 0.05, 0.44, 0.345), 0x1a1d26], [box(0.03, 0.04, 0.02, -0.05, 0.44, 0.345), 0x1a1d26], // eyes
    [box(0.045, 0.045, 0.2).rotateX(0.7).translate(0, 0.36, -0.28), 0xffffff],          // tail up
  ];
  for (const lx of [-0.07, 0.07]) for (const lz of [-0.14, 0.14]) dogParts.push([box(0.06, 0.17, 0.06, lx, 0.085, lz), 0xffffff]);
  const dogMesh = inst(mergeParts(dogParts, true), toonMat({ vertexColors: true }), dogs.length, true);
  const dogInk = inst(dogHull, getOutlineMat(), dogs.length);
  dogs.forEach((d, i) => dogMesh.setColorAt(i, col.setHex(d.coat)));
  // Leads, one segment per dog (a loose dog's stays collapsed).
  const leashGeo = new THREE.BufferGeometry();
  leashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dogs.length * 6), 3));
  const leash = new THREE.LineSegments(leashGeo, new THREE.LineBasicMaterial({ color: 0x2a2320 }));
  leash.frustumCulled = false; leash.raycast = noRaycast;
  scene.add(leash);
  pedestrians = { people, dogs, meshes, dogMesh, dogInk, leash };
}

// Weather: rain (streaking points) or snow (soft points). Toggleable.
function buildWeather() {
  const N = 900;
  const pos = new Float32Array(N * 3);
  const data = [];
  for (let i = 0; i < N; i++) {
    const x = (Math.random() - 0.5) * 120, y = Math.random() * 60, z = (Math.random() - 0.5) * 120;
    pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z;
    data.push({ y, speed: 25 + Math.random()*15, drift: Math.random()*2 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0x9fc0ff, size: 0.12, transparent: true, opacity: 0.7 });
  const snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.9 });
  const points = new THREE.Points(geo, rainMat);
  points.visible = false;
  scene.add(points);
  weather = { points, geo, data, rainMat, snowMat, mode: 'clear' };
}

// Commit shuttles: small particles orbiting the tallest building.
function buildCommitShuttles(repos, user) {
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
function buildForkBeams(repos) {
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

function setWeather(mode, btn) {
  weatherMode = mode;
  if (weather) {
    weather.points.visible = mode !== 'clear';
    weather.points.material = mode === 'rain' ? weather.rainMat : weather.snowMat;
    weather.points.scale.y = mode === 'rain' ? 4 : 1;
  }
  if (btn) {
    btn.textContent = mode === 'clear' ? 'Clear' : mode === 'rain' ? 'Rain' : 'Snow';
    btn.classList.toggle('on', mode !== 'clear');
  }
}

// Showcase flight — the default way into a city. The camera flies from
// building to building (most-starred first), circles each one while a name
// card shows, and every few stops swoops out over the island. It loops until
// you take the controls (drag, scroll, click), and T / Tour toggles it.
const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const _tp = new THREE.Vector3(), _tl = new THREE.Vector3();
const smootherstep = (u) => u * u * u * (u * (u * 6 - 15) + 10);
// A leg is { dur, pos(u, out), look(u, out), repo? } with u running 0..1.
function orbitLeg(b, fallbackBearing, { dur = 6.5, sweep = 1.4, loop = false } = {}) {
  const cx = b.mesh.position.x, cz = b.mesh.position.z, h = b.h || 8;
  const r = Math.max(20, h * 0.8 + 16);
  // Stay above the neighbouring rooftops so a dense city never clips the camera.
  let roof = 0;
  for (const o of buildingMeshes) if (o !== b && Math.hypot(o.mesh.position.x - cx, o.mesh.position.z - cz) < r + 8) roof = Math.max(roof, o.h || 0);
  const y = Math.max(10, h * 0.6 + 6, roof + 6);
  const out = Math.hypot(cx, cz) > 1 ? Math.atan2(cz, cx) : fallbackBearing; // start on the side facing out of town
  const a0 = out - sweep / 2;
  return {
    dur, loop, repo: b.repo,
    pos: (u, o) => o.set(cx + Math.cos(a0 + sweep * u) * r, y + (loop ? 0 : Math.sin(u * Math.PI) * 2), cz + Math.sin(a0 + sweep * u) * r),
    look: (u, o) => o.set(cx, h * 0.55, cz),
  };
}
function flyLeg(fromPos, fromLook, toPos, toLook, dur) {
  const p0 = fromPos.clone(), p2 = toPos.clone(), l0 = fromLook.clone(), l2 = toLook.clone();
  const p1 = p0.clone().lerp(p2, 0.5);
  p1.y = Math.max(p0.y, p2.y) + 16; // arc up and over the rooftops
  return {
    dur,
    pos: (u, o) => {
      const e = smootherstep(u), a = 1 - e;
      return o.set(a * a * p0.x + 2 * a * e * p1.x + e * e * p2.x, a * a * p0.y + 2 * a * e * p1.y + e * e * p2.y, a * a * p0.z + 2 * a * e * p1.z + e * e * p2.z);
    },
    look: (u, o) => o.copy(l0).lerp(l2, smootherstep(u)),
  };
}
function overviewLeg(bearing) {
  const look = new THREE.Vector3(0, 4, 0);
  return { dur: 7, pos: (u, o) => o.set(Math.cos(bearing + u * 0.6) * 150, 72, Math.sin(bearing + u * 0.6) * 150), look: (u, o) => o.copy(look) };
}
// Tour order: the developer's highlights first (city.json "featured", then the
// profile's pinned repos when known), then on through all their other repos.
function tourStops() {
  const byName = new Map(buildingMeshes.map(b => [String(b.repo.name).toLowerCase(), b]));
  const picks = [], seen = new Set();
  const add = (b, highlight) => { if (b && !seen.has(b)) { seen.add(b); picks.push({ b, highlight }); } };
  for (const n of cfgNow()?.featured || []) add(byName.get(String(n).toLowerCase()), 'featured');
  for (const n of pinnedRepos) add(byName.get(String(n).toLowerCase()), 'pinned');
  // ...then every other repo in the city, most-starred first (the tour loops after the last).
  for (const b of [...buildingMeshes].sort((x, y) => (y.repo.stargazers_count || 0) - (x.repo.stargazers_count || 0))) add(b, null);
  return picks;
}
function buildShowcase(start = 0) {
  if (!tour.stops) { const picks = tourStops(); tour.stops = picks.map(p => p.b); tour.highlights = picks.map(p => p.highlight); }
  const stops = tour.stops;
  if (!stops.length) return null;
  const legs = [];
  let pos = camera.position.clone(), look = controls.target.clone();
  let bearing = Math.atan2(camera.position.z, camera.position.x);
  const push = (leg) => {
    const fly = flyLeg(pos, look, leg.pos(0, new THREE.Vector3()), leg.look(0, new THREE.Vector3()), legs.length ? 3.6 : 3);
    if (leg.repo) Object.assign(fly, { repo: leg.repo, stop: leg.stop, of: leg.of, highlight: leg.highlight, next: true }); // announce the next repo on the way
    legs.push(fly);
    legs.push(leg);
    pos = leg.pos(1, new THREE.Vector3()); look = leg.look(1, new THREE.Vector3());
  };
  for (let i = start; i < stops.length; i++) {
    push(Object.assign(orbitLeg(stops[i], bearing), { stop: i + 1, of: stops.length, highlight: tour.highlights?.[i] || null }));
    if (i % 3 === 2 && i < stops.length - 1) { bearing += 2.1; push(overviewLeg(bearing)); }
  }
  return legs;
}
function updateTour(dt) {
  if (!tour.legs) { tour.legs = buildShowcase(); tour.leg = 0; }
  if (!tour.legs) { endTour(); return; }
  tour.t += dt;
  let leg = tour.legs[tour.leg];
  while (leg && tour.t >= leg.dur) { tour.t -= leg.dur; leg = tour.legs[++tour.leg]; }
  if (!leg) { tour.legs = null; tour.t = 0; return; } // loop: the next frame plans a new round from here
  if (!leg.next && leg.repo && !leg.planned) {
    leg.planned = true; // entering this stop: stay longer if its README has a picture to show
    if (readmeKnown.get(leg.repo.full_name)?.image) leg.dur = Math.max(leg.dur, 11);
  }
  const u = tour.t / leg.dur;
  if (leg.stop) tour.stop = leg.stop - 1;
  camera.position.copy(leg.pos(u, _tp));
  controls.target.copy(leg.look(u, _tl));
  showcaseCard(leg.repo ? leg : null);
}
// Jump the showcase to the next (+1) / previous (-1) repo, or back to the
// current one (0, after the user looked around): fly there from wherever the camera is.
function tourJump(dir) {
  if (!tour.active) return;
  if (!tour.stops) buildShowcase(); // fixes the stop list
  const n = tour.stops?.length || 0;
  if (!n) return;
  tour.legs = buildShowcase(((tour.stop || 0) + dir + n) % n);
  tour.leg = 0; tour.t = 0; tour.paused = false;
  controls.autoRotate = false;
}
// A small TV set for the showcase: which repo the camera is heading to or
// circling, what it is, and how popular. It flickers like a CRT on each change.
function showcaseCard(leg) {
  let el = document.getElementById('showcase-card');
  if (!el) {
    el = document.createElement('div');
    el.id = 'showcase-card';
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<div class="sc-screen"><div class="sc-kicker"></div><div class="sc-name"></div>
        <div class="sc-pic"><img alt="" referrerpolicy="no-referrer" decoding="async"></div>
        <div class="sc-desc"></div><div class="sc-meta"></div><div class="sc-readme"></div></div>
      <div class="sc-chin"><span class="sc-led"></span>
        <button class="sc-ch" type="button" data-dir="-1" aria-label="Previous repo">‹</button><span class="sc-stop"></span>
        <button class="sc-ch" type="button" data-dir="1" aria-label="Next repo">›</button>
        <span class="sc-hint">← → switch · click a building to watch</span></div>`;
    el.querySelectorAll('.sc-ch').forEach(b => b.addEventListener('click', () => tourJump(Number(b.dataset.dir))));
    document.body.appendChild(el);
  }
  const repo = leg?.repo || null, key = repo ? `${repo.full_name || repo.name}|${leg.next ? 'next' : 'here'}` : null;
  if (tour.card === key) return;
  const sameRepo = repo && tour.card && tour.card.split('|')[0] === (repo.full_name || repo.name);
  tour.card = key;
  if (!repo) { el.classList.remove('show'); return; }
  el.querySelector('.sc-kicker').textContent = (leg.next ? 'Next stop' : 'Now circling') + (leg.highlight ? ` · ${leg.highlight}` : '');
  el.querySelector('.sc-name').textContent = repo.name;
  el.querySelector('.sc-desc').textContent = repo.description || 'No description yet.';
  const days = repo.pushed_at ? Math.max(0, Math.round((Date.now() - Date.parse(repo.pushed_at)) / 86400000)) : null;
  const meta = [`★ ${fmtNum(repo.stargazers_count || 0)}`, `⑂ ${fmtNum(repo.forks_count || 0)}`, repo.language,
    days == null ? '' : days === 0 ? 'updated today' : `updated ${days}d ago`].filter(Boolean);
  el.querySelector('.sc-meta').replaceChildren(...meta.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  el.querySelector('.sc-stop').textContent = leg.stop ? `${leg.stop} / ${leg.of}` : '';
  el.style.setProperty('--sc-lang', langHex(repo.language));
  // A few lines from the README (plain text only), and the next stop's fetched ahead.
  const readme = el.querySelector('.sc-readme'), pic = el.querySelector('.sc-pic img');
  const stillHere = () => tour.card && tour.card.startsWith(`${repo.full_name || repo.name}|`);
  if (!sameRepo) { readme.textContent = ''; el.classList.remove('has-pic', 'pic-loading', 'pic-in'); pic.removeAttribute('src'); }
  readmeExcerpt(repo).then(({ text, image }) => {
    if (!stillHere()) return;
    readme.textContent = text;
    if (image && pic.getAttribute('src') !== image) {
      // Reserve the screen at once (a "tuning in" static), then tune the picture in when it arrives.
      el.classList.add('has-pic', 'pic-loading');
      el.classList.remove('pic-in');
      pic.onload = () => {
        if (!stillHere()) return;
        if (pic.naturalWidth < 120) { el.classList.remove('has-pic', 'pic-loading'); return; } // an icon, not a picture
        el.classList.remove('pic-loading');
        void pic.offsetWidth;
        el.classList.add('pic-in');
      };
      pic.onerror = () => el.classList.remove('has-pic', 'pic-loading');
      pic.src = image;
    }
  });
  const upcoming = tour.stops?.[leg.stop % (tour.stops?.length || 1)];
  if (upcoming) readmeExcerpt(upcoming.repo);
  el.classList.add('show');
  if (!sameRepo) { el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); } // CRT channel change
}
// README excerpts for the showcase TV: fetched from raw.githubusercontent.com
// (no API quota), cached per repo. Text is plain text only (never HTML). The
// picture is the README's first real image, and only if GitHub hosts it —
// visitors' browsers never fetch from arbitrary sites a README points at.
const readmeCache = new Map();
const readmeKnown = new Map(); // resolved excerpts, readable synchronously (the tour plans stop lengths with it)
const README_IMG_HOSTS = new Set(['raw.githubusercontent.com', 'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com', 'camo.githubusercontent.com', 'github.com']);
function readmeExcerpt(repo) {
  const key = repo?.full_name;
  if (!key) return Promise.resolve({ text: '', image: '' });
  if (!readmeCache.has(key)) readmeCache.set(key, (async () => {
    // Raw URLs are case-sensitive: README.md is most common, readme.md next (e.g. sindresorhus).
    for (const name of ['README.md', 'readme.md']) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${key}/HEAD/${name}`, { signal: ctrl.signal });
        if (r.ok) {
          const md = (await r.text()).slice(0, 30000);
          const found = { text: markdownExcerpt(md), image: readmeImage(md, key) };
          readmeKnown.set(key, found);
          return found;
        }
      } catch { /* offline or slow: try the next spelling */ } finally { clearTimeout(to); }
    }
    readmeKnown.set(key, { text: '', image: '' });
    return readmeKnown.get(key);
  })());
  return readmeCache.get(key);
}
function readmeImage(md, fullName) {
  const srcs = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)) srcs.push([m.index, m[1]]);
  for (const m of md.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) srcs.push([m.index, m[1]]);
  srcs.sort((a, b) => a[0] - b[0]);
  for (const [, raw] of srcs) {
    const src = raw.trim();
    if (/badge|shields\.io|travis|circleci|codecov|coveralls|gitter|sponsor|backer|opencollective|donate|patreon|buymeacoffee/i.test(src)) continue;
    let url;
    try {
      url = /^https?:\/\//i.test(src) ? new URL(src)
        : new URL(src.replace(/^\.?\//, ''), `https://raw.githubusercontent.com/${fullName}/HEAD/`);
    } catch { continue; }
    if (url.protocol !== 'https:' || !README_IMG_HOSTS.has(url.hostname)) continue;
    if (url.hostname === 'github.com') {
      // github.com/<o>/<r>/blob/<ref>/<path> -> raw; user-attachments pass through.
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
      if (m) url = new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`);
      else if (!url.pathname.startsWith('/user-attachments/')) continue;
    }
    return url.href;
  }
  return '';
}
function markdownExcerpt(md) {
  const text = md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    // Whole HTML blocks (centred logos, sponsor strips, badge tables) are chrome, not prose.
    .replace(/<(div|p|table|picture|details|center|h[1-6]|sup|sub)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')   // linked badges
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                // images
    .replace(/<[^>]*>/g, ' ')                             // stray html
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // links -> their text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&[a-z]+;|&#\d+;/gi, ' ');
  const paras = text.split(/\n\s*\n/)
    .map((p) => p.replace(/^\s{0,3}(#+|>|[-*+]|\d+\.)\s*/gm, '').replace(/[*_`~|]/g, '').replace(/\s+/g, ' ').trim())
    .filter((p) => {
      const words = p.split(' ');
      if (words.length < 8 || !/[a-z]{3}/.test(p) || /^(table of contents|contents)\b/i.test(p)) return false;
      if (!/[.!?:;,]/.test(p)) return false; // prose, not a row of link labels
      const caps = words.filter((w) => /^[A-Z]/.test(w)).length;
      return caps / words.length < 0.6 && !/\bsponsor(ed|s)?\b/i.test(p);
    });
  const out = paras.slice(0, 2).join(' ');
  return out.length > 460 ? `${out.slice(0, 457).trimEnd()}…` : out;
}
function startTour() {
  tour.active = true; tour.paused = false; tour.t = 0; tour.leg = 0; tour.legs = null; tour.stops = null; tour.stop = 0;
  controls.autoRotate = false;
  document.getElementById('tour-btn')?.classList.add('on');
}
function endTour() {
  tour.active = false; tour.paused = false; tour.legs = null; tour.stops = null;
  showcaseCard(null);
  document.getElementById('tour-btn')?.classList.remove('on');
}

// ---------------------------------------------------------------------------
// Actor — the profile's avatar, Gource-style: it hovers over the plaza and,
// during playback, flies to each repository it touched and beams at it.
// ---------------------------------------------------------------------------
function makeGlowTexture(size = 64) {
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

function buildActor() {
  const group = new THREE.Group();
  const glowTex = makeGlowTexture();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: ACCENT, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.set(13, 13, 1);
  group.add(halo);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: ACCENT, transparent: true, depthWrite: false }));
  sprite.scale.set(7.5, 7.5, 1);
  group.add(sprite);
  // Beam: a tapering cylinder hanging from the actor down to the roof.
  const beamMat = new THREE.MeshBasicMaterial({
    color: ACCENT, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beamGeo = new THREE.CylinderGeometry(0.3, 1.1, 1, 14, 1, true);
  beamGeo.translate(0, -0.5, 0); // pivot at the top so scale.y grows downward
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.visible = false;
  group.add(beam);
  // Impact ring on the roof: expands and fades while the beam is on.
  const ringMat = new THREE.MeshBasicMaterial({
    color: ACCENT, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.0, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  group.position.set(0, 20, 0);
  scene.add(group);
  actor = {
    group, sprite, halo, beam, beamMat, ring, ringMat, glowTex,
    idle: new THREE.Vector3(0, 20, 0), pos: new THREE.Vector3(0, 20, 0),
  };
}

// Round avatar with a teal rim, drawn onto the actor sprite. Falls back to the
// plain glowing orb when the avatar can't be fetched.
function buildAvatar(user) {
  if (!actor) return;
  const mat = actor.sprite.material;
  if (mat.map && mat.map !== actor.glowTex) mat.map.dispose();
  mat.map = actor.glowTex;
  mat.color.set(ACCENT);
  mat.needsUpdate = true;
  const url = (user && user.avatar_url) || '';
  if (!url) return;
  const version = cityVersion;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (version !== cityVersion) return;
    const size = 256, canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = size / 2 - 16;
    ctx.save();
    ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, 16, 16, size - 32, size - 32);
    ctx.restore();
    ctx.lineWidth = 9; ctx.strokeStyle = '#64dedb';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = '#0a0d16'; // ink rim, like every other outline in town
    ctx.beginPath(); ctx.arc(size / 2, size / 2, r + 7, 0, Math.PI * 2); ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
  };
  img.src = url;
}

function buildingAnchor(step, out) {
  const b = step && buildingByName.get(step.repo);
  if (!b) return out.copy(actor.idle);
  return out.set(b.mesh.position.x, b.h + 7, b.mesh.position.z);
}

function updateActor(dt) {
  if (!actor) return;
  const t = clock.getElapsed();
  actor.halo.material.opacity = 0.34 + Math.sin(t * 2.2) * 0.1;
  actor.halo.material.rotation = t * 0.3;
  let acting = 0, target = null;
  if (timeline && timeline.steps.length) {
    // Before the first play the actor rests on the plaza instead of acting step 0.
    const armed = play.playing || play.t > 0;
    const st = actorState(timeline.steps, armed ? play.t : -1, { travel: TRAVEL, act: TRAVEL + ACT });
    if (st.index >= 0) {
      const step = timeline.steps[st.index];
      const to = buildingAnchor(step, _v1);
      const from = st.from === null ? _v2.copy(actor.idle) : buildingAnchor(timeline.steps[st.from], _v2);
      const k = st.travel, e = k * k * (3 - 2 * k);
      actor.pos.lerpVectors(from, to, e);
      actor.pos.y += Math.sin(k * Math.PI) * Math.min(14, from.distanceTo(to) * 0.25);
      acting = st.travel >= 1 ? Math.max(0, 1 - (st.since - TRAVEL) / ACT) : 0;
      target = buildingByName.get(step.repo) || null;
      // One-shot effects fire exactly once per step, in playback order.
      if (st.index !== play.lastIndex) {
        if (st.index > play.lastIndex && st.index - play.lastIndex <= 3) announceStep(step);
        play.lastIndex = st.index;
        if (target) { target.pulse = 1; spawnBurst(target, KIND_COLORS[step.label] || '#c2cad8'); }
        updateClock(step, st.index);
      }
    } else {
      actor.pos.copy(actor.idle);
      if (play.lastIndex !== -1) { play.lastIndex = -1; updateClock(null, -1); }
    }
  } else {
    actor.pos.copy(actor.idle);
  }
  const bob = timeline && play.playing ? 0 : Math.sin(t * 1.2) * 0.5;
  actor.group.position.set(actor.pos.x, actor.pos.y + bob, actor.pos.z);

  if (acting > 0 && target) {
    const step = timeline.steps[play.lastIndex];
    const top = target.h + 0.6;
    const len = Math.max(0.1, actor.group.position.y - 3 - top);
    actor.beam.visible = true;
    actor.beam.position.y = -3;
    actor.beam.scale.set(1, len, 1);
    actor.beamMat.opacity = 0.3 + acting * 0.5;
    actor.beamMat.color.set(KIND_COLORS[step?.label] || '#64dedb');
    actor.ring.visible = true;
    actor.ring.position.set(target.mesh.position.x, top + 0.2, target.mesh.position.z);
    const sc = 1.5 + (1 - acting) * 7;
    actor.ring.scale.set(sc, sc, 1);
    actor.ringMat.opacity = acting * 0.8;
    actor.ringMat.color.copy(actor.beamMat.color);
  } else {
    actor.beam.visible = false;
    actor.ring.visible = false;
  }
  for (const b of buildingMeshes) if (b.pulse) b.pulse = Math.max(0, b.pulse - dt * 1.4);
  updateBursts(dt);
}

function spawnBurst(b, cssColor) {
  const N = 28;
  const pos = new Float32Array(N * 3), vel = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 8;
    vel.push(new THREE.Vector3(Math.cos(a) * r, 5 + Math.random() * 9, Math.sin(a) * r));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(cssColor), size: 0.6, map: actor.glowTex, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.position.set(b.mesh.position.x, b.h + 0.8, b.mesh.position.z);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 0, ttl: 1.3 });
  if (bursts.length > 12) killBurst(bursts.shift());
}
function killBurst(bu) { scene.remove(bu.pts); bu.geo.dispose(); bu.mat.dispose(); }
function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const bu = bursts[i];
    bu.life += dt;
    const p = bu.geo.attributes.position.array;
    for (let j = 0; j < bu.vel.length; j++) {
      const v = bu.vel[j];
      v.y -= 14 * dt;
      p[j * 3] += v.x * dt; p[j * 3 + 1] += v.y * dt; p[j * 3 + 2] += v.z * dt;
    }
    bu.geo.attributes.position.needsUpdate = true;
    bu.mat.opacity = Math.max(0, 1 - bu.life / bu.ttl);
    if (bu.life >= bu.ttl) { killBurst(bu); bursts.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Cars — cute cel-shaded traffic (sedan, compact, taxi, pickup, van, bus) on
// the boulevard and on the ring road just outside the plaza. Each car type is
// five merged geometries built once and every material is shared by the whole
// fleet, so a city rebuild only re-creates cheap Mesh wrappers.
// ---------------------------------------------------------------------------
const CAR_PAINTS = [0xe85d5d, 0x4d9be6, 0x58c99b, 0xf39a4b, 0xa480e0, 0xf2ede2, 0xf08fb8, 0x3fc1ba];
const BUS_PAINTS = [0xf0714f, 0x3fb6c9, 0x58c99b];
const TAXI_YELLOW = 0xf6c343;
const INNER_RING = 2.5 * CELL; // street loop at x, z = ±22.5, just outside the plaza
let carKit = null;   // shared geometries + materials, built on first use
let carLanes = [];   // { path, dir, length, cars[] }
const _tan1 = new THREE.Vector2(), _tan2 = new THREE.Vector2(), _carPt = new THREE.Vector2();

// Side profile (x = length, y = height) with rounded corners, extruded across
// the width and centred on z.
function sideExtrude(pts, radii, width) {
  const s = new THREE.Shape(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i], [ax, ay] = pts[(i + n - 1) % n], [bx, by] = pts[(i + 1) % n];
    const r = radii[i] || 0;
    const da = Math.hypot(ax - px, ay - py), db = Math.hypot(bx - px, by - py);
    const ka = Math.min(r, da / 2) / da, kb = Math.min(r, db / 2) / db;
    const sx = px + (ax - px) * ka, sy = py + (ay - py) * ka;
    if (i === 0) s.moveTo(sx, sy); else s.lineTo(sx, sy);
    if (r > 0) s.quadraticCurveTo(px, py, px + (bx - px) * kb, py + (by - py) * kb);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -width / 2);
}

// One car type: rounded body, glass greenhouse with a painted roof and pillars,
// wheels with hub caps, bumpers, head/tail lights and an ink hull.
// Local frame: +x forward, y up from the road, centred on x and z.
function makeCarType(o) {
  const { L, W, wr, wheelX, y0, y1, rf, rb, cab } = o;
  const x0 = -L / 2, x1 = L / 2, wc = W - 0.16;
  const paint = [], fixed = [], head = [], tail = [], hull = [];
  const body = sideExtrude([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [0.08, 0.08, rf, rb], W);
  const cabin = sideExtrude([[cab.rb, y1 - 0.02], [cab.fb, y1 - 0.02], [cab.ft, cab.top], [cab.rt, cab.top]], [0, 0, 0.14, 0.12], wc);
  hull.push(hullOf(body, 0.16), hullOf(cabin, 0.14));
  paint.push(body, box(cab.ft - cab.rt + 0.1, 0.1, wc + 0.06, (cab.ft + cab.rt) / 2, cab.top - 0.02, 0)); // roof
  for (const px of cab.pillars) paint.push(box(0.12, cab.top - y1, wc + 0.03, px, (cab.top + y1) / 2, 0));
  fixed.push([cabin, 0x9ad3ea]);
  for (const x of wheelX) for (const s of [-1, 1]) {
    const z = s * (W / 2 - 0.1);
    fixed.push([new THREE.CylinderGeometry(wr, wr, 0.26, 12).rotateX(Math.PI / 2).translate(x, wr, z), 0x1d212b]);
    fixed.push([new THREE.CylinderGeometry(wr * 0.46, wr * 0.46, 0.3, 8).rotateX(Math.PI / 2).translate(x, wr, z), 0xcfd5de]);
  }
  for (const bx of [x1 + 0.01, x0 - 0.01]) fixed.push([box(0.14, 0.16, W - 0.08, bx, y0 + 0.1, 0), 0x363c4a]);
  const ly = o.lampY ?? y0 + (y1 - y0) * 0.55;
  for (const s of [-1, 1]) {
    head.push(box(0.08, 0.14, 0.26, x1 - 0.01, ly, s * (W / 2 - 0.25)));
    tail.push(box(0.08, 0.13, 0.22, x0 + 0.01, ly, s * (W / 2 - 0.22)));
  }
  o.extra?.({ paint, fixed, head, hull, x0, x1, W, wc });
  return { L, paint: mergeParts(paint), fixed: mergeParts(fixed, true), head: mergeParts(head), tail: mergeParts(tail), hull: mergeParts(hull) };
}

function getCarKit() {
  if (carKit) return carKit;
  const shared = m => { m.userData.shared = true; return m; };
  const sedan = { L: 2.6, W: 1.3, wr: 0.3, wheelX: [-0.85, 0.85], y0: 0.22, y1: 0.8, rf: 0.26, rb: 0.2,
    cab: { rb: -1.0, fb: 0.46, rt: -0.76, ft: 0.08, top: 1.3, pillars: [-0.32] } };
  const types = {
    sedan: makeCarType(sedan),
    taxi: makeCarType({ ...sedan, extra: ({ head, fixed }) => {
      head.push(box(0.5, 0.2, 0.34, -0.34, 1.43, 0));             // lit roof sign
      fixed.push([box(2.0, 0.09, 1.32, 0, 0.64, 0), 0x2a2f3a]);     // dark side band
    } }),
    compact: makeCarType({ L: 2.1, W: 1.22, wr: 0.28, wheelX: [-0.68, 0.68], y0: 0.2, y1: 0.72, rf: 0.3, rb: 0.24,
      cab: { rb: -0.9, fb: 0.4, rt: -0.8, ft: -0.02, top: 1.3, pillars: [-0.38] } }),
    pickup: makeCarType({ L: 2.8, W: 1.34, wr: 0.33, wheelX: [-0.92, 0.92], y0: 0.26, y1: 0.84, rf: 0.24, rb: 0.08,
      cab: { rb: -0.22, fb: 0.74, rt: -0.22, ft: 0.38, top: 1.44, pillars: [] },
      extra: ({ paint, fixed, hull, x0, W }) => {
        fixed.push([box(1.12, 0.04, W - 0.2, -0.8, 0.855, 0), 0x3a3f4c]); // open bed
        for (const s of [-1, 1]) paint.push(box(1.18, 0.18, 0.08, -0.8, 0.93, s * (W / 2 - 0.04)));
        paint.push(box(0.08, 0.18, W, x0 + 0.04, 0.93, 0));
        hull.push(hullOf(box(1.26, 0.18, W, -0.76, 0.93, 0), 0.12));
      } }),
    van: makeCarType({ L: 2.9, W: 1.4, wr: 0.32, wheelX: [-0.95, 0.98], y0: 0.25, y1: 0.85, rf: 0.3, rb: 0.12,
      cab: { rb: -1.43, fb: 1.02, rt: -1.43, ft: 0.62, top: 1.72, pillars: [] },
      extra: ({ paint, fixed, wc }) => {
        paint.push(box(1.52, 0.87, wc + 0.04, -0.69, 1.285, 0));          // cargo box behind the cab
        fixed.push([box(1.44, 0.12, wc + 0.06, -0.69, 1.2, 0), 0xf4efe4]); // livery stripe
      } }),
    bus: makeCarType({ L: 4.8, W: 1.5, wr: 0.34, wheelX: [-1.55, 1.5], y0: 0.3, y1: 1.0, rf: 0.2, rb: 0.16, lampY: 0.55,
      cab: { rb: -2.32, fb: 2.34, rt: -2.32, ft: 2.28, top: 1.74, pillars: [-1.65, -0.85, -0.05, 0.75, 1.55] },
      extra: ({ fixed, head }) => {
        fixed.push([box(4.5, 0.14, 1.52, 0, 0.62, 0), 0xf4efe4]);          // livery band
        head.push(box(0.05, 0.14, 0.9, 2.3, 1.6, 0));                      // destination sign
      } }),
  };
  // Headlight pools: a trapezoid on the road (u along the beam, v across it)
  // with a soft canvas falloff, so it reads as light rather than a decal.
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.06, -0.45, 0, 0.06, 0.45, 5, 0.06, 1.6, 5, 0.06, -1.6], 3));
  beamGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
  beamGeo.setIndex([0, 1, 2, 0, 2, 3]);
  beamGeo.userData.shared = true;
  const bc = document.createElement('canvas');
  bc.width = bc.height = 64;
  const bctx = bc.getContext('2d'), img = bctx.createImageData(64, 64);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
    const u = i / 63, v = j / 63, k = (j * 64 + i) * 4;
    const a = Math.pow(1 - u, 1.5) * Math.min(1, u * 8) * (1 - Math.pow(Math.abs(v * 2 - 1), 2.5));
    img.data.set([255, 236, 190, Math.round(a * 255)], k);
  }
  bctx.putImageData(img, 0, 0);
  const beamTex = new THREE.CanvasTexture(bc);
  beamTex.colorSpace = THREE.SRGBColorSpace;
  const paints = new Map();
  carKit = {
    types, beamGeo,
    paint: hex => paints.get(hex) || paints.set(hex, shared(toonMat({ color: hex }))).get(hex),
    fixed: shared(toonMat({ vertexColors: true })),
    head: shared(toonMat({ color: 0xfff6d8, emissive: 0xffe2a0, emissiveIntensity: 0.2 })),
    tail: shared(toonMat({ color: 0xe0443e, emissive: 0xff3b30, emissiveIntensity: 0.15 })),
    beam: shared(new THREE.MeshBasicMaterial({
      map: beamTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })),
  };
  return carKit;
}

function makeCar(kind, hex) {
  const kit = getCarKit(), t = kit.types[kind];
  const paint = new THREE.Mesh(t.paint, kit.paint(hex)), fixed = new THREE.Mesh(t.fixed, kit.fixed);
  paint.castShadow = fixed.castShadow = true;
  const body = new THREE.Group(); // leans into corners; the headlight pool stays on the road
  body.add(paint, fixed, new THREE.Mesh(t.head, kit.head), new THREE.Mesh(t.tail, kit.tail), new THREE.Mesh(t.hull, getOutlineMat()));
  const beam = new THREE.Mesh(kit.beamGeo, kit.beam);
  beam.position.x = t.L / 2 - 0.1;
  const car = new THREE.Group();
  car.add(body, beam);
  car.traverse(o => { if (o.isMesh) o.raycast = noRaycast; });
  car.userData = { body, len: t.L };
  return car;
}

function buildCars(user) {
  // Cars only wrap the shared kit, so clearing them has nothing to dispose.
  carGroup.clear();
  const rnd = seededRandom(hashStr(`traffic:${user?.login || ''}`));
  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const boulevard = shuffle(['sedan', 'compact', 'taxi', 'van', 'pickup', 'bus', 'sedan', 'compact', 'taxi', 'van', 'compact', 'sedan']);
  const inner = shuffle(['compact', 'sedan', 'taxi', 'van']);
  const paints = shuffle([...CAR_PAINTS, ...CAR_PAINTS]);
  // Right-hand traffic: each loop's outer lane runs one way, its inner lane the other.
  // The boulevard lanes follow the city footprint (smooth closed curves 0.85
  // either side of its centreline); the inner loop hugs the plaza.
  const L = cityLayout || makeCityLayout('square');
  const specs = [
    { path: boulevardLane(L, 0.85), dir: -1, kinds: boulevard.slice(0, 6), speed: 10 },
    { path: boulevardLane(L, -0.85), dir: 1, kinds: boulevard.slice(6), speed: 10 },
    { path: roundedRect(THREE, INNER_RING + 0.8, 2.8, THREE.Path), dir: -1, kinds: inner.slice(0, 2), speed: 6.5 },
    { path: roundedRect(THREE, INNER_RING - 0.8, 1.2, THREE.Path), dir: 1, kinds: inner.slice(2), speed: 6.5 },
  ];
  carLanes = specs.map(spec => {
    const path = spec.path;
    const lane = { path, dir: spec.dir, length: path.getLength(), cars: [] };
    spec.kinds.forEach((kind, k) => {
      const hex = kind === 'taxi' ? TAXI_YELLOW
        : kind === 'bus' ? BUS_PAINTS[Math.floor(rnd() * BUS_PAINTS.length)] : paints.pop();
      const car = makeCar(kind, hex), d = car.userData;
      d.u = (k + 0.15 + rnd() * 0.5) / spec.kinds.length;
      d.speed = spec.speed * (kind === 'bus' ? 0.8 : 0.88 + rnd() * 0.24);
      d.v = d.speed; d.roll = 0; d.yaw = null;
      lane.cars.push(car);
      carGroup.add(car);
    });
    return lane;
  });
  updateCars(0);
}

function updateCars(dt) {
  const wrap = u => ((u % 1) + 1) % 1;
  for (const { path, dir, length, cars } of carLanes) {
    for (const car of cars) {
      const d = car.userData;
      // Keep a gap to the car ahead in this lane, so slow cars bunch traffic up.
      let gap = Infinity;
      for (const o of cars) {
        if (o !== car) gap = Math.min(gap, wrap((o.userData.u - d.u) * dir) * length - (o.userData.len + d.len) / 2);
      }
      // Ease off into the rounded corners: compare the heading 6 units ahead.
      path.getTangentAt(d.u, _tan1);
      path.getTangentAt(wrap(d.u + dir * 6 / length), _tan2);
      const bend = Math.min(1, Math.acos(THREE.MathUtils.clamp(_tan1.dot(_tan2), -1, 1)) / (Math.PI / 2));
      const want = d.speed * (1 - 0.4 * bend) * THREE.MathUtils.smoothstep(gap, 1.2, 7);
      d.v += (want - d.v) * Math.min(1, dt * (want < d.v ? 4 : 1.5)); // brake harder than it accelerates
      d.u = wrap(d.u + dir * d.v * dt / length);
      path.getPointAt(d.u, _carPt);
      path.getTangentAt(d.u, _tan1);
      const yaw = Math.atan2(-_tan1.y * dir, _tan1.x * dir);
      if (d.yaw === null) d.yaw = yaw;
      const dyaw = Math.atan2(Math.sin(yaw - d.yaw), Math.cos(yaw - d.yaw));
      d.yaw = yaw;
      // Cartoon suspension: the body leans out of the turn a touch.
      const lean = dt > 0 ? THREE.MathUtils.clamp(dyaw / dt * 0.045, -0.09, 0.09) : 0;
      d.roll += (lean - d.roll) * Math.min(1, dt * 6);
      car.position.set(_carPt.x, 0.09, _carPt.y);
      car.rotation.y = yaw;
      d.body.rotation.x = d.roll;
    }
  }
}

// ---- enhancement motion (all guarded, cheap) -----------------------------
function updateFountain() {
  if (fountain?.update) fountain.update(clock.getElapsed(), dayFactor);
}
function updatePedestrians(dt) {
  if (!pedestrians?.people) return;
  const { people, dogs, meshes, dogMesh, dogInk, leash } = pedestrians, t = clock.getElapsed();
  const limb = (mesh, i, x, y, ax, az) => {
    _pl.copy(_pm).multiply(_pt.makeTranslation(x, y, 0)).multiply(_pr.makeRotationFromEuler(_pe.set(ax, 0, az, 'ZYX')));
    mesh.setMatrixAt(i, _pl);
  };
  people.forEach((p, i) => {
    let y = PLAZA_Y, h = p.h, swing = 0, leg = 0, arm = 0, wave = 0;
    if (p.mode === 'walk') {
      p.a += p.w * dt;
      p.phase += p.v * 8 * dt;
      p.x = Math.cos(p.a) * p.r; p.z = Math.sin(p.a) * p.r;
      h = p.h = p.w > 0 ? -p.a : Math.PI - p.a;
      swing = Math.sin(p.phase);
      y += Math.abs(Math.cos(p.phase)) * 0.045; // step bob
    } else if (p.mode === 'sit') {
      y = p.y; leg = -1.35; arm = -0.3;
      swing = Math.sin(t * 1.4 + p.phase) * 0.12; // idly swinging feet
    } else {
      // Chatting: a gentle sway, and every so often an arm goes up mid-story.
      h += Math.sin(t * 0.6 + p.phase) * 0.12;
      y += Math.max(0, Math.sin(t * 2.2 + p.phase)) * 0.02;
      wave = -1.9 * Math.pow(Math.max(0, Math.sin(t * 0.9 + p.phase * 2)), 4);
    }
    _pm.makeRotationY(h).setPosition(p.x, y, p.z);
    for (const k of ['torso', 'head', 'hair', 'eyes', 'hull']) meshes[k].setMatrixAt(i, _pm);
    const legSwing = p.mode === 'walk' ? swing * 0.55 : swing;
    limb(meshes.legL, i, 0.075, 0.4, leg + legSwing, 0);
    limb(meshes.legR, i, -0.075, 0.4, leg - legSwing, 0);
    limb(meshes.armL, i, 0.22, 0.8, arm - swing * 0.5, 0.12);
    limb(meshes.armR, i, -0.22, 0.8, arm + swing * 0.5 + wave, -0.12);
  });
  for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
  const lp = leash.geometry.attributes.position.array;
  dogs.forEach((d, i) => {
    const o = d.owner;
    let x = d.x, z = d.z, h = d.h, y = PLAZA_Y;
    if (o) {
      // Trots a step behind its owner, on the open side of the promenade.
      const side = o.w > 0 ? 0.45 : -0.45, a = o.a - Math.sign(o.w) * 0.8 / o.r;
      x = Math.cos(a) * (o.r + side); z = Math.sin(a) * (o.r + side); h = o.h;
      y += Math.abs(Math.sin(o.phase * 1.3 + d.phase)) * 0.06;
      // Lead from the owner's hand on that side to the collar.
      const hs = Math.sign(side) * 0.26;
      lp.set([o.x + Math.cos(o.a) * hs, PLAZA_Y + 0.5, o.z + Math.sin(o.a) * hs,
        x + Math.sin(h) * 0.22, y + 0.34, z + Math.cos(h) * 0.22], i * 6);
    } else {
      h += Math.sin(t * 3) * 0.08;
      y += Math.abs(Math.sin(t * 5)) * 0.015;
    }
    _pm.makeRotationY(h).setPosition(x, y, z);
    dogMesh.setMatrixAt(i, _pm);
    dogInk.setMatrixAt(i, _pm);
  });
  dogMesh.instanceMatrix.needsUpdate = dogInk.instanceMatrix.needsUpdate = true;
  leash.geometry.attributes.position.needsUpdate = true;
}
function updateWeather(dt) {
  if (!weather || weather.mode === 'clear') return;
  const { points, geo, data, N } = weather;
  const pos = geo.attributes.position.array;
  const rain = weather.mode === 'rain';
  for (let i = 0; i < N; i++) {
    data[i].y -= data[i].speed * dt;
    if (data[i].y < 0) data[i].y = 60;
    pos[i*3+1] = data[i].y;
    pos[i*3] += Math.sin(clock.getElapsed() + data[i].drift) * dt * 2;
  }
  geo.attributes.position.needsUpdate = true;
  // stretch rain into streaks via scale (cheap fake)
  points.scale.y = rain ? 4 : 1;
}
function updateShuttles(dt) {
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
function updateBeams(dt) {
  if (!forkBeams) return;
  const t = clock.getElapsed();
  for (const b of forkBeams.beams) b.material.opacity = 0.3 + Math.sin(t * 2) * 0.15;
}

// ---------------------------------------------------------------------------
// Day / night cycle
// ---------------------------------------------------------------------------
function applyDayFactor(t) {
  // t in [0,1): 0 = midday, 0.5 = midnight.
  if (dayMode === 'sunset') t = 0.2; // city.json look.time "sunset": a fixed low sun (~30% daylight)
  const elev = Math.cos(t * Math.PI * 2);           // 1 noon -> -1 midnight
  const day = THREE.MathUtils.clamp(elev, 0, 1);     // 0..1 daylight amount
  dayFactor = day;

  // Sun / moon. Nights are moonlit, not black: a strong cool key light from the
  // moon plus a lifted sky fill, so the island still reads after dark.
  sun.intensity = 0.15 + day * 1.35;
  moon.intensity = 0.08 + (1 - day) * 1.15;
  hemi.intensity = 0.75 + day * 0.5;

  // Sky dome + fog lerp: moonlit night blue -> warm daytime. The dome shader
  // paints the sky; we only lerp the fog color to match its horizon.
  if (skyDome) skyDome.setDay(day);
  const nightFog = new THREE.Color(0x17223a);
  const dayFog = new THREE.Color(0xcfe4f4);
  const fog = nightFog.clone().lerp(dayFog, day);
  if (scene.fog) scene.fog.color.copy(fog);
  // Materials never fall all the way to their night colour: moonlight keeps
  // ~30% of the day palette (world.js uses the same floor for its cutouts).
  const lit = day + (1 - day) * 0.3;
  for (const e of envPalette) e.mat.color.copy(e.night).lerp(e.day, lit);
  hemi.groundColor.setHex(0x1a1410).lerp(_tmpColor.setHex(0x5f9a58), day);
  world?.setDay(day);

  // Window emissive rises as daylight fades (full glow by night).
  const glow = Math.pow(1 - day, 1.6);
  // Lit panes come from each facade's emissive mask; a beam hit flares them.
  for (const b of buildingMeshes) {
    const flick = 0.92 + Math.sin(clock.getElapsed() * 0.7 + b.flicker) * 0.08;
    const inten = glow * flick * 1.15 + (b.pulse || 0) * 1.8;
    for (const m of b.bodyMats) m.emissiveIntensity = inten;
  }
  // "Office party" windows pulse a little above the base glow, and warm
  // windows get a faint per-building flicker so the skyline feels alive.
  for (const wp of windowPulse) {
    wp.mat.emissiveIntensity = glow * (0.9 + Math.sin(clock.getElapsed() * 3 + wp.phase) * 0.5);
  }
  // Streetlamps + plaza neon flare up at night; their light cones fade in too.
  if (lampGroup) {
    for (const l of lampGroup.children) l.userData.mat.emissiveIntensity = 0.1 + glow * 2.2;
    for (const cm of (lampGroup.userData.cones || [])) cm.opacity = glow * 0.22;
  }
  const beacon = cityGroup.userData.beacon;
  if (beacon) beacon.material.emissiveIntensity = 0.6 + glow * 1.2;
  plazaFx?.setGlow(glow);
  // Car head/tail lights come on at dusk; headlight pools appear on the road.
  if (carKit) {
    carKit.head.emissiveIntensity = 0.2 + glow * 1.8;
    carKit.tail.emissiveIntensity = 0.15 + glow * 1.5;
    carKit.beam.opacity = glow * 0.5;
    carKit.beam.visible = glow > 0.02;
  }
}

// ---------------------------------------------------------------------------
// Interaction (raycast hover + click)
// ---------------------------------------------------------------------------
function onPointerMove(e) {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  doHover(e.clientX, e.clientY);
}

function doHover(cx, cy) {
  raycaster.setFromCamera(pointerNDC, camera);
  const bodies = buildingMeshes.flatMap(b => b.bodies);
  const hits = raycaster.intersectObjects(bodies, false);
  const tip = document.getElementById('tooltip');
  if (hits.length > 0) {
    const b = hits[0].object.userData.building;
    if (hovered !== b) {
      hovered = b;
      showTooltip(b, cx, cy);
      document.body.style.cursor = 'pointer';
    } else {
      positionTooltip(cx, cy);
    }
  } else if (hovered) {
    hovered = null;
    tip.classList.remove('show');
    document.body.style.cursor = '';
  }
}

function showTooltip(b, cx, cy) {
  const tip = document.getElementById('tooltip');
  const r = b.repo;
  const colorHex = LANG_COLORS[(r.language || '').toLowerCase()] ?? FALLBACK_COLOR;
  const desc = (r.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  tip.innerHTML = `
    <div class="tt-name">${escapeHtml(r.name)}</div>
    ${desc ? `<div class="tt-desc">${desc}</div>` : ''}
    <div class="tt-meta">
      <span>⭐ ${fmtNum(r.stargazers_count)}</span>
      <span>🍴 ${fmtNum(r.forks_count)}</span>
      ${r.language ? `<span><span class="tt-lang" style="background:#${colorHex.toString(16).padStart(6,'0')}"></span>${escapeHtml(r.language)}</span>` : ''}
    </div>`;
  tip.classList.add('show');
  positionTooltip(cx, cy);
}
function positionTooltip(cx, cy) {
  const tip = document.getElementById('tooltip');
  const pad = 14;
  let x = cx + pad, y = cy + pad;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  if (x + w > window.innerWidth - 8) x = cx - w - pad;
  if (y + h > window.innerHeight - 8) y = cy - h - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function onPointerDown(e) {
  // Only treat as a click if not a drag: we approximate by checking that the
  // pointer hasn't moved much since the last move event (OrbitControls also
  // handles drags). We just raycast on pointerup with a small delta guard.
  onPointerDown._sx = e.clientX; onPointerDown._sy = e.clientY;
}
function onPointerUp(e) {
  if (swallowTap) { swallowTap = false; onPointerDown._sx = null; return; }
  if (onPointerDown._sx == null || e.button !== 0) return;
  const dx = e.clientX - onPointerDown._sx, dy = e.clientY - onPointerDown._sy;
  onPointerDown._sx = null;
  if (Math.hypot(dx, dy) > 6) return; // was a drag
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const bodies = buildingMeshes.flatMap(b => b.bodies);
  const hits = raycaster.intersectObjects(bodies, false);
  if (hits.length > 0) {
    // Clicking a building plays its history straight away; the repo panel
    // opens behind the player so the details are there when you close it.
    const building = hits[0].object.userData.building, repo = building.repo;
    openPanel(repo);
    flyToBuilding(building);
    if (repo.full_name) openGource(repo, { x: e.clientX, y: e.clientY });
  } else closePanel();
}

function openPanel(repo) {
  ensureBuildingConfig(repo); // its .git-city/building.json, if not fetched yet (restyles the building when it lands)
  if (isCompact()) { setMenu(false); setProfile(false); }
  const panel = document.getElementById('panel');
  const colorHex = LANG_COLORS[(repo.language || '').toLowerCase()] ?? FALLBACK_COLOR;
  document.getElementById('panel-title').textContent = repo.name;
  const desc = repo.description || '';
  document.getElementById('panel-body').innerHTML = `
    <div id="panel-desc">${escapeHtml(desc)}</div>
    <div class="pgrid">
      <div class="cell"><div class="cv">⭐ ${fmtNum(repo.stargazers_count)}</div><div class="cl">Stars</div></div>
      <div class="cell"><div class="cv">🍴 ${fmtNum(repo.forks_count)}</div><div class="cl">Forks</div></div>
      <div class="cell"><div class="cv">${fmtNum(repo.watchers_count)}</div><div class="cl">Watchers</div></div>
      <div class="cell"><div class="cv">${escapeHtml(repo.license?.spdx_id || '—')}</div><div class="cl">License</div></div>
    </div>
    <div id="panel-lang">
      <span class="dot" style="background:#${colorHex.toString(16).padStart(6,'0')}"></span>
      ${repo.language ? escapeHtml(repo.language) : 'Unknown language'}
    </div>
    <div class="panel-section">Details</div>
    <div id="panel-desc">
      Created ${escapeHtml(repo.created_at?.slice(0,10) || '')} ·
      Updated ${escapeHtml(repo.pushed_at?.slice(0,10) || '')}<br>
      Default branch: <b>${escapeHtml(repo.default_branch || '')}</b><br>
      ${repo.archived ? '<b>Archived</b> · ' : ''}${repo.fork ? 'Fork · ' : ''}
      Size ${fmtBytes(repo.size * 1024)}
    </div>
    <a id="panel-link" href="${repo.html_url}" target="_blank" rel="noopener">Open on GitHub ↗</a>
    ${repo.full_name ? `<button id="panel-gource" type="button"
      title="Replay this repository's commit history, Gource-style">▶ Watch its history</button>
      <a id="panel-gource-ext" href="${gourceUrl(repo)}" target="_blank" rel="noopener">open in Gource View ↗</a>` : ''}`;
  document.getElementById('panel-gource')?.addEventListener('click', () => openGource(repo));
  panel.classList.add('open');
}
function closePanel() {
  const panel = document.getElementById('panel');
  const wasOpen = panel.classList.contains('open');
  panel.classList.remove('open');
  if (wasOpen) returnToOrbit();
}

// Gource View in a lightbox: the repo's whole commit history replayed as a
// growing tree, without leaving the city. The iframe only exists while the
// player is open, so nothing plays or downloads in the background.
// video=1 opens Gource View's clean "▶ Video" composition as soon as the
// history has loaded, instead of the full app UI; embed=1 hides its scrubber
// and has it tell this page when the video opens / closes (postMessage).
function gourceUrl(repo, { video = true } = {}) {
  // music=none: the embedded player plays without music.
  return `${GOURCE_VIEW}?repo=${encodeURIComponent(repo.full_name)}&max=3000${video ? '&video=1&embed=1&music=none' : ''}`;
}
// The player loads hidden: a small chip shows progress at the clicked
// building, and once Gource View's video is ready the player morphs out of that
// point. Embedded Gource View posts 'video-open' / 'video-close' messages;
// until a deployment has them, a timer reveals it and (same origin only) Esc
// inside the frame is intercepted.
const GOURCE_ORIGIN = new URL(GOURCE_VIEW).origin;
let gourceTimer = 0;
let gourceRepoName = '';
let gourceNotBefore = 0; // opened from a building click: let the fly-in land first
// While the TV covers the screen the city stops rendering, so the GPU (and a
// phone's battery) goes to the video. It resumes as the set powers off.
let gourceCovering = false;
function openGource(repo, from = null) {
  let box = document.getElementById('gource-modal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'gource-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `<div class="gm-loading" role="status"><span class="gm-spin"></span><span class="gm-ltext"></span>
        <button class="gm-cancel" type="button" aria-label="Cancel">×</button></div>
      <div class="gm-card">
        <div class="gm-screen"><div class="gm-frame"></div><div class="gm-crt"></div></div>
        <div class="gm-head"><span class="gm-led"></span><span class="gm-title"></span>
          <a class="gm-ext" target="_blank" rel="noopener">Open in new tab ↗</a>
          <button class="gm-close" type="button" aria-label="Close">×</button></div>
      </div>`;
    box.addEventListener('click', (e) => { if (e.target === box) closeGource(true); });
    box.querySelector('.gm-close').addEventListener('click', () => closeGource(true));
    box.querySelector('.gm-cancel').addEventListener('click', () => closeGource());
    document.body.appendChild(box);
  }
  closeGource();
  const url = gourceUrl(repo);
  const at = from || { x: innerWidth / 2, y: innerHeight / 2 };
  box.style.setProperty('--gx', `${at.x}px`);
  box.style.setProperty('--gy', `${at.y}px`);
  box.querySelector('.gm-title').textContent = `${repo.full_name} · commit history`;
  gourceRepoName = repo.name;
  gourceNotBefore = from ? performance.now() + 2600 : 0;
  box.querySelector('.gm-ltext').textContent = `Replaying ${repo.name}…`;
  box.querySelector('.gm-ext').href = url;
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.title = `Gource View: ${repo.full_name}`;
  frame.allow = 'autoplay; fullscreen';
  frame.allowFullscreen = true;
  frame.addEventListener('load', () => {
    try { // same origin (the live site): Esc in the frame closes the whole player
      frame.contentWindow.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGource(true); }
      }, true);
    } catch { /* cross-origin (local preview): rely on postMessage */ }
  });
  box.querySelector('.gm-frame').replaceChildren(frame);
  box.classList.add('open', 'pending');
  // Last-resort fallback only: gource-view posts 'video-ready' when its first frame is up
  // (big histories like torvalds/linux can take well over 10 s to load).
  gourceTimer = setTimeout(revealGource, 30000);
  document.addEventListener('keydown', gourceKeys, true);
}
function revealGource() {
  const box = document.getElementById('gource-modal');
  if (!box?.classList.contains('pending')) return;
  clearTimeout(gourceTimer);
  // Opened from a building click: power on only once the fly-in has landed
  // (flight time is frame time, so slow devices take longer than the nominal 2.6 s).
  const flying = gourceNotBefore && cine && cine.leg === 0 && cine.legs.length > 1;
  if (flying || gourceNotBefore - performance.now() > 0) { gourceTimer = setTimeout(revealGource, 150); return; }
  const card = box.querySelector('.gm-card').getBoundingClientRect();
  const gx = parseFloat(box.style.getPropertyValue('--gx')), gy = parseFloat(box.style.getPropertyValue('--gy'));
  box.style.setProperty('--ox', `${gx - card.left}px`);
  box.style.setProperty('--oy', `${gy - card.top}px`);
  box.classList.remove('pending');
  box.classList.add('reveal');
  setTimeout(() => { if (box.classList.contains('reveal') && !box.classList.contains('off')) gourceCovering = true; }, 700);
  // Start the video once the morph has (nearly) finished, so it's seen from its first frame.
  const frame = box.querySelector('iframe');
  setTimeout(() => frame?.contentWindow?.postMessage({ source: 'git-city', type: 'play' }, GOURCE_ORIGIN), 650);
}
let gourceOffTimer = 0;
function closeGource(animated = false) {
  gourceCovering = false;
  clearTimeout(gourceTimer);
  clearTimeout(gourceOffTimer);
  const box = document.getElementById('gource-modal');
  if (!box) return;
  if (animated && box.classList.contains('reveal') && !box.classList.contains('off')) {
    box.classList.add('off'); // the tube powers off, then the set goes away
    gourceOffTimer = setTimeout(() => closeGource(false), 360);
    return;
  }
  box.classList.remove('open', 'pending', 'reveal', 'off');
  box.querySelector('.gm-frame').replaceChildren(); // stops playback and downloads
  document.removeEventListener('keydown', gourceKeys, true);
}
window.addEventListener('message', (e) => {
  if (e.origin !== GOURCE_ORIGIN || e.data?.source !== 'gource-view') return;
  // 'video-ready' arrives once the first frame is on screen; 'video-open' (the
  // view has mounted) only arms a short fallback in case 'ready' never comes.
  if (e.data.type === 'video-ready') revealGource();
  else if (e.data.type === 'video-open') { clearTimeout(gourceTimer); gourceTimer = setTimeout(revealGource, 2500); }
  else if (e.data.type === 'video-close' || e.data.type === 'error') closeGource(true);
  else if (e.data.type === 'progress') {
    // Big histories take a while (torvalds/linux is ~3000 commits): show how far along it is.
    const el = document.querySelector('#gource-modal.pending .gm-ltext');
    const pct = Math.max(0, Math.min(100, Math.round(+e.data.pct || 0)));
    if (el) el.textContent = `Replaying ${gourceRepoName}… ${pct}%`;
    // Still loading, and saying so: keep waiting for 'video-ready' rather than revealing a loading screen.
    if (el) { clearTimeout(gourceTimer); gourceTimer = setTimeout(revealGource, 30000); }
  }
});
function gourceKeys(e) {
  // While the player is open it owns the keyboard: Esc closes it and nothing
  // leaks through to the city's shortcuts (Space, T, explore keys).
  if (e.key === 'Escape') closeGource(true);
  e.stopPropagation();
}

// ---------------------------------------------------------------------------
// HUD wiring
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// HUD: profile explorer, timeline clock, activity feed, transport
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function langHex(lang) {
  return '#' + (LANG_COLORS[(lang || '').toLowerCase()] ?? FALLBACK_COLOR).toString(16).padStart(6, '0');
}

function renderExplorer(user, repos) {
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const langCount = {};
  for (const r of repos) {
    if (!r.language) continue;
    const k = r.language.toLowerCase();
    langCount[k] = (langCount[k] || 0) + 1;
  }
  const langs = Object.entries(langCount).sort((a, b) => b[1] - a[1]);
  const topLang = langs[0]?.[0];
  $('hud-login').textContent = user.login;
  $('hud-status').innerHTML = `${repos.length} repos · <span class="live">fetching activity…</span>`;
  $('stat-card').innerHTML = `
    <div class="head"><span class="dot"></span>${escapeHtml(user.name || 'Profile')}</div>
    <div class="row"><span>Repositories</span><b class="tnum">${repos.length}</b></div>
    <div class="row"><span>Stars</span><b class="tnum">${fmtNum(totalStars)}</b></div>
    <div class="row"><span>Followers</span><b class="tnum">${fmtNum(user.followers)}</b></div>
    <div class="row"><span>Top language</span><b>${topLang ? escapeHtml(prettify(topLang)) : '—'}</b></div>
    <div class="row"><span>Local time</span><b class="tnum" id="dev-time">—</b></div>`;
  updateDevClock();
  renderTopCard('Tallest towers', repos.slice(0, 5).map(r => ({
    full_name: r.full_name, name: r.name, language: r.language, value: `★ ${fmtNum(r.stargazers_count)}`,
  })), 'var(--orange)');
  $('legend-rows').innerHTML = langs.slice(0, 8).map(([lang]) =>
    `<div class="row"><span class="swatch" style="background:${langHex(lang)}"></span>${escapeHtml(prettify(lang))}</div>`
  ).join('') || '<div class="row">—</div>';
}

function renderTopCard(title, rows, dot) {
  $('top-card').innerHTML =
    `<div class="head"><span class="dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>${escapeHtml(title)}</div>` +
    rows.map(r => `<div class="row repo" data-repo="${escapeHtml(r.full_name || '')}" title="Focus ${escapeHtml(r.name)}">
      <span class="nm"><span class="sw" style="background:${langHex(r.language)}"></span>${escapeHtml(r.name)}</span>
      <b class="tnum">${escapeHtml(r.value)}</b></div>`).join('');
}

// Clicking a building (or a repo in the lists) flies the camera to it; closing
// the repo panel (✕, Esc, or a click on empty ground) flies back to where you
// were orbiting and resumes the orbit.
let orbitReturn = null;
let tourResumeTimer = 0;
// A short camera script (same legs as the showcase): { legs, leg, t, onDone }.
let cine = null;
function updateCine(dt) {
  cine.t += dt;
  let leg = cine.legs[cine.leg];
  while (leg && cine.t >= leg.dur) {
    cine.t -= leg.dur;
    if (leg.loop) break; // the last leg circles until something else takes over
    leg = cine.legs[++cine.leg];
  }
  if (!leg) { const done = cine.onDone; cine = null; done?.(); return; }
  const u = Math.min(1, cine.t / leg.dur);
  camera.position.copy(leg.pos(u, _tp));
  controls.target.copy(leg.look(u, _tl));
}
function flyToBuilding(b) {
  if (explorer?.ownsCamera) return; // walk / drive / fly own the camera
  endTour();
  if (!orbitReturn) orbitReturn = { target: controls.target.clone(), position: camera.position.clone(), autoRotate: controls.autoRotate };
  controls.autoRotate = false;
  camGoal = null;
  // Arc up over the rooftops into a framing orbit, then circle slowly while its panel is open.
  const circle = orbitLeg(b, Math.atan2(camera.position.z, camera.position.x), { dur: 40, sweep: Math.PI * 2, loop: true });
  cine = { legs: [flyLeg(camera.position, controls.target, circle.pos(0, new THREE.Vector3()), circle.look(0, new THREE.Vector3()), 2.6), circle], leg: 0, t: 0 };
}
function returnToOrbit() {
  if (!orbitReturn || explorer?.ownsCamera) { orbitReturn = null; cine = null; return; }
  const back = orbitReturn, resume = back.autoRotate || flyover;
  orbitReturn = null;
  camGoal = null;
  cine = { legs: [flyLeg(camera.position, controls.target, back.position, back.target, 2.6)], leg: 0, t: 0,
    onDone: () => { controls.autoRotate = resume; } };
}
function focusRepo(fullName) {
  const b = buildingByName.get(fullName);
  if (!b) return;
  openPanel(b.repo);
  flyToBuilding(b);
}

function updateClock(step, index) {
  if (!step) {
    $('clk-day').textContent = '—'; $('clk-mon').textContent = '—'; $('clk-year').textContent = '';
    const days = timeline?.days || activity.days;
    $('clk-sub').textContent = timeline?.steps.length ? `press play to replay the last ${days} days` : `no public activity in the last ${days} days`;
    $('play-date').textContent = '—';
    return;
  }
  const d = dateParts(step.ts);
  $('clk-day').textContent = d.day; $('clk-mon').textContent = d.month; $('clk-year').textContent = d.year;
  $('clk-sub').textContent = `${d.weekday} · event ${index + 1} of ${timeline.steps.length}`;
  $('play-date').textContent = d.iso;
}

function announceStep(step) {
  const feed = $('feed');
  const card = document.createElement('div');
  card.className = 'card feed-card';
  card.style.setProperty('--c', KIND_COLORS[step.label] || '#c2cad8');
  const short = step.repo.split('/').pop();
  const meta = step.kind === 'PushEvent'
    ? `${step.commits} commit${step.commits === 1 ? '' : 's'}`
    : step.count > 1 ? `${step.verb} ×${step.count}` : step.verb;
  card.innerHTML = `<div class="fc-kind">${escapeHtml(step.label)}</div>
    <div class="fc-repo">${escapeHtml(short)}</div>
    <div class="fc-meta">${escapeHtml(meta)} · ${dateParts(step.ts).iso}</div>
    ${step.commits > 1 ? `<div class="fc-n">${step.commits}</div>` : ''}`;
  feed.prepend(card);
  while (feed.children.length > 4) feed.lastElementChild.remove();
  [...feed.children].forEach((c, i) => c.classList.toggle('fading', i >= 3));
}
function clearFeed() { $('feed').innerHTML = ''; }

function renderActivityStrip() {
  const hist = timeline?.hist || [];
  const max = Math.max(1, ...hist);
  $('activity').innerHTML = hist.map(v => `<span style="height:${Math.max(7, (v / max) * 100).toFixed(0)}%"></span>`).join('');
  const from = dateParts(Date.now() - Math.max(0, hist.length - 1) * 86400000);
  $('activity-range').textContent = `${from.month} ${from.day} → today · ${timeline?.events.length || 0} events`;
}

function updateTransport() {
  if (!timeline) return;
  const frac = timeline.duration ? play.t / timeline.duration : 0;
  const scrub = $('scrub');
  scrub.value = Math.round(frac * 1000);
  scrub.style.setProperty('--p', (frac * 100).toFixed(1) + '%');
  const btn = $('play-btn');
  btn.textContent = play.playing ? '❚❚' : '▶';
  btn.setAttribute('aria-label', play.playing ? 'Pause' : 'Play');
  const bars = $('activity').children;
  const idx = play.lastIndex;
  if (bars.length && timeline.steps.length) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const cur = new Date(idx >= 0 ? timeline.steps[idx].ts : timeline.first); cur.setUTCHours(0, 0, 0, 0);
    const curBar = bars.length - 1 - Math.round((today - cur) / 86400000);
    if (curBar !== updateTransport._bar || (idx < 0) !== updateTransport._idle) {
      updateTransport._bar = curBar; updateTransport._idle = idx < 0;
      for (let i = 0; i < bars.length; i++) {
        bars[i].classList.toggle('played', idx >= 0 && i < curBar);
        bars[i].classList.toggle('now', idx >= 0 && i === curBar);
      }
    }
  }
}

function setPlaying(on) {
  if (!timeline || !timeline.steps.length) on = false;
  if (on) endTour(); // playback takes the camera (Follow) from the showcase
  if (on && play.t >= timeline.duration) { play.t = 0; play.lastIndex = -1; clearFeed(); }
  play.playing = on;
  if (on) { camGoal = null; controls.autoRotate = flyover; }
  updateTransport();
}
function seekTo(frac) {
  if (!timeline) return;
  play.t = Math.max(0, Math.min(1, frac)) * timeline.duration;
  const idx = stepIndexAt(timeline.steps, play.t);
  play.lastIndex = idx - 1; // replay the current step's effects once
  clearFeed();
  updateClock(idx >= 0 ? timeline.steps[idx] : null, idx);
  updateTransport();
}
function setSpeed(speed) {
  play.speed = speed;
  document.querySelectorAll('.sp').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === speed));
}

// The activity playback covers the last 7 days by default (widened to 30 / 90
// when that week was quiet); the 7d / 30d / 90d chips pick a range by hand.
const ACTIVITY_RANGES = [7, 30, 90];
let activity = { days: 7, picked: false, events: [], repos: [] };
function eventsWithin(events, days) {
  const from = Date.now() - days * 86400000;
  return events.filter(e => Date.parse(e.created_at) >= from);
}
function setupTimeline(events, repos) {
  activity.events = events; activity.repos = repos;
  if (!activity.picked) activity.days = ACTIVITY_RANGES.find(d => eventsWithin(events, d).length >= 3) || 90;
  const days = activity.days, inRange = eventsWithin(events, days);
  const names = buildingMeshes.map(b => b.repo.full_name).filter(Boolean);
  const built = buildTimeline(inRange, names);
  const { steps, duration } = paceTimeline(built.steps);
  timeline = { steps, duration, events: inRange, days, hist: dailyHistogram(inRange, days), first: built.first, last: built.last };
  play.t = 0; play.lastIndex = -1; play.playing = false;
  clearFeed();
  renderActivityStrip();
  updateClock(null, -1);
  $('play-btn').disabled = steps.length === 0;
  $('scrub').disabled = steps.length === 0;
  updateTransport();
  $('hud-status').innerHTML = `${repos.length} repos · <span class="live">${steps.length} event${steps.length === 1 ? '' : 's'} · ${days} days</span>`;
  $('activity-title').textContent = `Public activity · last ${days} days`;
  document.querySelectorAll('.rg').forEach(b => b.classList.toggle('on', Number(b.dataset.days) === days));
  const active = activityByRepo(steps);
  if (active.length) {
    renderTopCard('Most active', active.slice(0, 5).map(([name, n]) => ({
      full_name: name, name: name.split('/').pop(), language: buildingByName.get(name)?.repo.language, value: `${n} ev`,
    })), 'var(--accent)');
  }
}

// Phones, small tablets and landscape phones share the compact layout.
const compactMQ = window.matchMedia('(max-width: 900px), (max-height: 500px)');
function isCompact() { return compactMQ.matches; }
function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  $('menu-btn').setAttribute('aria-expanded', String(open));
}
function setProfile(open) {
  $('explorer').classList.toggle('open', open);
  const t = $('profile-toggle');
  t.setAttribute('aria-expanded', String(open));
  t.setAttribute('aria-label', open ? 'Hide profile details' : 'Show profile details');
}
function readPref(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writePref(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }
function setFx(on, { remember = true } = {}) { // remember: false for a city.json look.fx (not the viewer's preference)
  fxOn = on;
  $('fx-btn').classList.toggle('on', on);
  if (remember) writePref('gc-fx', on ? '1' : '0');
}
// Old-TV mode: a CRT shader on the 3D view plus a light scanline overlay on the
// whole page. Switching it on plays a quick "power on" flick.
function setTv(on, { animate = true, remember = true } = {}) { // remember: false for a city.json look.tv
  tvOn = on;
  $('tv-btn').classList.toggle('on', on);
  document.body.classList.toggle('tv', on);
  if (remember) writePref('gc-tv', on ? '1' : '0');
  const canvas = renderer.domElement;
  canvas.classList.remove('tv-power-on');
  if (on && animate) { void canvas.offsetWidth; canvas.classList.add('tv-power-on'); }
}

function setDayMode(mode) {
  dayMode = mode;
  $('dn-label').textContent = { auto: 'Auto', cycle: 'Cycle', day: 'Day', night: 'Night', sunset: 'Sunset' }[mode];
  $('daynight-btn').classList.toggle('on', mode === 'auto' || mode === 'cycle');
}
// Daylight from the viewer's local time: dark until ~05:30, full day 08:30–17:00,
// dusk until ~20:00. Mapped back onto applyDayFactor's phase (0 = noon).
// The city's clock: 'auto' day/night follows the developer's local time when
// we know it: city.json look.timezone (IANA), else the UTC offset of their
// latest commit (a commit patch keeps its author's "Date: ... +0200"), else
// the viewer's own clock.
let devTz = { offset: null }; // minutes east of UTC
function devLocalTime(now = new Date()) {
  const zone = cfgNow()?.look?.timezone;
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
      const get = (t) => Number(parts.find(p => p.type === t)?.value);
      return { h: get('hour') + get('minute') / 60, label: zone.split('/').pop().replace(/_/g, ' ') };
    } catch { /* not a zone this browser knows: fall through */ }
  }
  if (devTz.offset != null) {
    const mins = (((now.getUTCHours() * 60 + now.getUTCMinutes() + devTz.offset) % 1440) + 1440) % 1440;
    const a = Math.abs(devTz.offset), mm = a % 60;
    return { h: mins / 60, label: `UTC${devTz.offset < 0 ? '−' : '+'}${Math.floor(a / 60)}${mm ? `:${String(mm).padStart(2, '0')}` : ''}` };
  }
  return { h: now.getHours() + now.getMinutes() / 60, label: 'your clock' };
}
function updateDevClock() {
  const el = document.getElementById('dev-time');
  if (!el) return;
  const { h, label } = devLocalTime();
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  el.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${label}`;
}
setInterval(updateDevClock, 30000);
const TZ_CACHE = 'gc-tz:';
async function detectDevOffset(login, events) {
  const key = TZ_CACHE + String(login).toLowerCase();
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 7 * 864e5) return c.offset; } catch { /* no storage */ }
  const push = (events || []).find(e => e.type === 'PushEvent' && e.payload?.head && e.repo?.name);
  if (!push) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${API}/repos/${push.repo.name}/commits/${push.payload.head}`, { headers: { Accept: 'application/vnd.github.patch' }, signal: ctrl.signal });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader(); // the Date header is near the top: read one chunk, not a whole big patch
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    const m = new TextDecoder().decode(value || new Uint8Array()).slice(0, 4096).match(/^Date: .* ([+-])(\d{2})(\d{2})$/m);
    if (!m) return null;
    const offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    try { localStorage.setItem(key, JSON.stringify({ offset, t: Date.now() })); } catch { /* no storage */ }
    return offset;
  } catch { return null; } finally { clearTimeout(to); }
}
function localClockPhase() {
  const h = devLocalTime().h;
  const ramp = (a, b) => THREE.MathUtils.clamp((h - a) / (b - a), 0, 1);
  const light = h < 12 ? ramp(5.5, 8.5) : 1 - ramp(17, 20);
  return Math.acos(light) / (Math.PI * 2);
}

function wireUI() {
  const form = $('search-form');
  const input = $('search-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const login = input.value.trim();
    if (login) explorer ? explorer.travelTo(login) : loadCity(login); // travel there through the island warp
  });
  document.querySelectorAll('#examples a[data-user]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    explorer ? explorer.travelTo(a.dataset.user) : loadCity(a.dataset.user);
  }));
  $('daynight-btn').addEventListener('click', () => {
    setDayMode({ auto: 'day', day: 'night', night: 'cycle', cycle: 'auto', sunset: 'night' }[dayMode]); // sunset: only via city.json
  });
  const flyBtn = $('flyover-btn');
  flyBtn.addEventListener('click', () => {
    flyover = !flyover;
    flyBtn.classList.toggle('on', flyover);
    controls.autoRotate = flyover;
  });
  const followBtn = $('follow-btn');
  followBtn.addEventListener('click', () => {
    follow = !follow;
    followBtn.classList.toggle('on', follow);
  });
  $('tour-btn').addEventListener('click', () => { tour.active ? endTour() : startTour(); });
  document.querySelectorAll('.rg').forEach(b => b.addEventListener('click', () => {
    activity.days = Number(b.dataset.days); activity.picked = true;
    if (activity.events.length || activity.repos.length) setupTimeline(activity.events, activity.repos);
  }));
  const wxBtn = $('weather-btn');
  wxBtn.addEventListener('click', () => {
    const order = { clear: 'rain', rain: 'snow', snow: 'clear' };
    setWeather(order[weatherMode], wxBtn);
  });
  // FX and TV are per-viewer preferences, remembered in this browser. A city whose
  // city.json sets look.fx / look.tv opens that way instead; toggling there lasts
  // the visit and leaves the saved preference alone.
  const fxBtn = $('fx-btn');
  setFx(readPref('gc-fx') === '1');
  fxBtn.addEventListener('click', () => setFx(!fxOn, { remember: cfgNow()?.look.fx === undefined }));
  setTv(readPref('gc-tv') === '1', { animate: false });
  $('tv-btn').addEventListener('click', () => setTv(!tvOn, { remember: cfgNow()?.look.tv === undefined }));
  $('customize-btn')?.addEventListener('click', () => customizer?.open()); // city.json editor (customize.js)
  // Transport
  $('play-btn').addEventListener('click', () => setPlaying(!play.playing));
  $('scrub').addEventListener('input', (e) => seekTo(Number(e.target.value) / 1000));
  const SPEED_STEPS = [0.5, 1, 2, 4];
  document.querySelectorAll('.sp').forEach(b => b.addEventListener('click', () => {
    // Compact layouts show only the active speed; tapping it cycles.
    const s = Number(b.dataset.speed);
    setSpeed(isCompact() && s === play.speed ? SPEED_STEPS[(SPEED_STEPS.indexOf(s) + 1) % SPEED_STEPS.length] : s);
  }));
  $('explorer').addEventListener('click', (e) => {
    const row = e.target.closest('[data-repo]');
    if (row && row.dataset.repo) { focusRepo(row.dataset.repo); if (isCompact()) setProfile(false); }
  });
  // Compact layout: menu dropdown, profile peek card, and bar-height CSS vars.
  $('menu-btn').addEventListener('click', (e) => { e.stopPropagation(); setMenu(!document.body.classList.contains('menu-open')); });
  document.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('menu-open') && !e.target.closest?.('#menu, #menu-btn')) {
      setMenu(false);
      swallowTap = true; // the tap that dismisses the menu must not also open a building
    }
  });
  document.querySelectorAll('#examples a[data-user]').forEach(a => a.addEventListener('click', () => setMenu(false)));
  $('profile-head').addEventListener('click', () => { if (isCompact()) setProfile(!$('explorer').classList.contains('open')); });
  const syncBars = () => {
    document.documentElement.style.setProperty('--topbar-h', $('topbar').offsetHeight + 'px');
    document.documentElement.style.setProperty('--transport-h', $('transport').offsetHeight + 'px');
  };
  if (window.ResizeObserver) { const ro = new ResizeObserver(syncBars); ro.observe($('topbar')); ro.observe($('transport')); }
  syncBars();
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable=true]')) return;
    if (explorer?.wantsKey(e)) return; // exploring: Space jumps/drifts, T is ignored (Esc and V still pass)
    if (tour.active && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); tourJump(e.key === 'ArrowRight' ? 1 : -1); return; }
    if (e.key === 't' || e.key === 'T') { tour.active ? endTour() : startTour(); }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!play.playing); }
    else if (e.key === 'Escape') { endTour(); closePanel(); setMenu(false); setProfile(false); }
    else if (e.key === 'v' || e.key === 'V') { setTv(!tvOn, { remember: cfgNow()?.look.tv === undefined }); }
  });
  $('panel-close').addEventListener('click', closePanel);
  $('reset-btn').addEventListener('click', resetCamera);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointerleave', () => {
    hovered = null;
    $('tooltip').classList.remove('show');
    document.body.style.cursor = '';
  });
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
function animate(timestamp) {
  requestAnimationFrame(animate);
  if (gourceCovering) return; // the history TV covers the city: skip rendering it
  clock.update(timestamp);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Day/night: 'auto' follows the viewer's clock, 'cycle' is the 60s demo loop.
  if (dayMode === 'auto') {
    applyDayFactor(localClockPhase());
  } else if (dayMode === 'cycle') {
    const t = ((clock.getElapsed() % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS);
    applyDayFactor(t);
  } else if (dayMode === 'day') {
    applyDayFactor(0.0);
  } else {
    applyDayFactor(0.5);
  }

  updateCars(dt);
  updateFountain();
  updatePlaza(dt);
  updatePedestrians(dt);
  updateWeather(dt);
  updateShuttles(dt);
  updateBeams(dt);

  // Timeline playback (Gource-style): advance, then let the actor act it out.
  if (timeline && play.playing) {
    play.t += dt * play.speed;
    if (play.t >= timeline.duration) { play.t = timeline.duration; play.playing = false; }
    updateTransport();
  }
  updateActor(dt);
  world?.update(dt, clock.getElapsed(), camera, controls.target);
  wayfinding?.update(dt, clock.getElapsed(), camera, dayFactor, explorer?.mode); // street signs dim at night; tag follows explore modes
  if (dust) { dust.update(dt, clock.getElapsed()); dust.setNight(1 - dayFactor); }
  if (skyDome) skyDome.setTime(clock.getElapsed());

  // Explore modes (explore.js) drive the camera while active (and while gliding
  // back to orbit): the tour, camGoal glide, follow and controls.update() stand down.
  const exploring = explorer ? explorer.update(dt, clock.getElapsed()) : false;
  // Cinematic fly-through (drives the camera; OrbitControls paused while active)
  const touring = tour.active && !tour.paused;
  if (touring && !exploring) updateTour(dt);
  else if (cine && !exploring) updateCine(dt); // click-a-building flight in / out
  const scripted = touring || !!cine;

  if (exploring) { /* explore.js placed the camera this frame */ }
  else if (!scripted) {
    if (camGoal) {
      const k = 1 - Math.exp(-dt * 3);
      controls.target.lerp(camGoal.target, k);
      camera.position.lerp(camGoal.position, k);
      if (camera.position.distanceTo(camGoal.position) < 0.3) {
        if (camGoal.resumeOrbit) controls.autoRotate = true; // back from a building: keep orbiting
        camGoal = null;
      }
    } else if (follow && play.playing && actor) {
      // The orbit target drifts toward wherever the actor is working.
      const k = 1 - Math.exp(-dt * 1.4);
      controls.target.lerp(_v1.set(actor.pos.x * 0.7, Math.min(24, actor.pos.y * 0.5), actor.pos.z * 0.7), k);
    }
    controls.update();
  } else camera.lookAt(controls.target);
  districtSigns?.group.children.forEach(sign => {
    sign.quaternion.copy(camera.quaternion);
    // Fade the big district labels out up close (showcase flight, explore modes).
    const fade = THREE.MathUtils.smoothstep(sign.getWorldPosition(_v2).distanceTo(camera.position), 18, 46);
    sign.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = fade; o.visible = fade > 0.02; } });
  });
  // TV wins over FX (it has its own grade); otherwise FX or a plain render.
  if (tvOn && crtPass) crtPass.render(clock.getElapsed());
  else if (fxOn && postPass) postPass.render(clock.getElapsed(), dayFactor);
  else renderer.render(scene, camera);
  explorer?.postRender?.(); // explore.js: full-screen island-travel warp over whichever frame was drawn
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtNum(n) {
  if (n == null) return '0';
  if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k';
  return String(n);
}
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function prettify(lang) {
  const map = { 'c++': 'C++', 'c#': 'C#', 'jupyter notebook': 'Jupyter' };
  return map[lang] || lang;
}
function setLoadStatus(msg) {
  const el = document.getElementById('load-status');
  if (el) el.textContent = msg;
}
function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (m.userData.shared) return;
        if (m.map && !m.map.userData.shared) m.map.dispose();
        if (m.emissiveMap && !m.emissiveMap.userData.shared) m.emissiveMap.dispose();
        m.dispose();
      });
    }
  });
}

// ---------------------------------------------------------------------------
// City config: the developer's <login>/<login>/.git-city/city.json. city-config.js
// fetches + validates it; this only reads the normalised result. Data only:
// its text reaches the page through fillText / textContent.
// ---------------------------------------------------------------------------
const cfgNow = () => cityConfig?.config || null;
// Repos in city order: hidden ones out, featured ones first (in their order), then by stars.
function rankRepos(repos) {
  const c = cfgNow();
  const hidden = new Set((c?.hide || []).map(n => n.toLowerCase()));
  const featured = (c?.featured || []).map(n => n.toLowerCase());
  const pos = (r) => { const i = featured.indexOf(String(r.name).toLowerCase()); return i < 0 ? Infinity : i; };
  return (repos || []).filter(r => !r.fork && !r.archived && !hidden.has(String(r.name).toLowerCase()))
    .sort((a, b) => (pos(a) - pos(b)) || (b.stargazers_count - a.stargazers_count))
    .slice(0, MAX_BUILDINGS);
}
const repoCfg = (repo) => cfgNow()?.repos[repo.name] || null; // a null-prototype map: any repo name is safe
const hexNum = (hex) => parseInt(hex.slice(1), 16);
// A repo's own .git-city/building.json, fetched lazily (the 16 most-starred buildings
// of a city, and any building when it's clicked) and kept for the visit:
// "owner/repo" (lower case) -> normalised config | null (none / unusable) | pending Promise.
const buildingFiles = new Map();
const BUILDING_PREFETCH = 16;
const buildingFile = (repo) => { const f = buildingFiles.get(String(repo.full_name || '').toLowerCase()); return f && !(f instanceof Promise) ? f : null; };
// The owner's city.json entry wins over the repo's file, field by field.
const buildingCfg = (repo) => mergeBuildingConfig(repoCfg(repo), buildingFile(repo));
function repoColor(repo) {
  const c = buildingCfg(repo).color;
  return c ? hexNum(c) : (LANG_COLORS[(repo.language || '').toLowerCase()] ?? FALLBACK_COLOR);
}
// Fetch + validate one building.json once per visit; resolves true when it set something.
function fetchBuildingFor(repo) {
  const key = String(repo.full_name || '').toLowerCase();
  const cur = buildingFiles.get(key);
  if (!key || cur !== undefined) return cur instanceof Promise ? cur.then(() => false) : Promise.resolve(false);
  const where = `${repo.full_name}/.git-city/building.json`;
  const p = fetchBuildingConfig(repo.full_name).then((res) => {
    let cfg = null;
    if (res.found && !res.error) {
      const { config, warnings } = normalizeBuildingConfig(res.raw);
      if (config && Object.keys(config).length) cfg = config;
      if (warnings.length) console.warn(`[git-city] ${where}: ${warnings.length} setting(s) ignored\n- ${warnings.join('\n- ')}`);
    } else if (res.found) console.warn(`[git-city] ${where} ignored: ${res.error}`);
    buildingFiles.set(key, cfg);
    return !!cfg;
  });
  buildingFiles.set(key, p);
  return p;
}
function loadBuildingConfigs(visible, version) {
  const top = [...visible].filter(r => r.full_name).sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, BUILDING_PREFETCH);
  Promise.all(top.map(fetchBuildingFor)).then((set) => {
    const hits = top.filter((r, i) => set[i]);
    if (hits.length && version === cityVersion) refreshBuildings(hits);
  });
}
function ensureBuildingConfig(repo) { // a clicked building: fetch its file if nobody has yet
  const version = cityVersion;
  fetchBuildingFor(repo).then((set) => { if (set && version === cityVersion) refreshBuildings([repo]); });
}
// Rebuild just these buildings in place (same lot), then re-letter the signs.
function refreshBuildings(repos) {
  let billboards = false;
  for (const repo of repos) {
    const b = buildingByName.get(repo.full_name);
    const i = buildingMeshes.indexOf(b);
    if (!b || i < 0) continue;
    const { x, z } = b.mesh.position, r = b.repo;
    cityGroup.remove(b.mesh);
    disposeObject(b.mesh);
    createBuilding(r, x, z, starsToHeight(r.stargazers_count), starsToFootprint(r.stargazers_count), repoColor(r), buildingCfg(r));
    buildingMeshes.splice(i, 1, buildingMeshes.pop()); // keep the order (the top building leads)
    if (hovered === b) hovered = null;
    billboards ||= !!buildingFile(r)?.billboard;
  }
  decorateBuildings();
  explorer?.resetColliders();
  if (billboards && profileNow) world.setProfile({ ...profileNow, config: worldConfig() }, cityLayout.city);
}
// Signs and street names follow the buildings (rebuilt with them).
function decorateBuildings(L = cityLayout) {
  // Repo names on the buildings, readable from walk / drive / fly; city.json / building.json can re-letter them.
  buildRepoSigns(THREE, buildingMeshes, repoColor, { signFor: (repo) => buildingCfg(repo).sign });
  // Streets named after the repos along them, and the explore-mode name tag (wayfinding.js).
  wayfinding?.dispose();
  wayfinding = buildWayfinding(THREE, { parent: cityGroup, buildings: buildingMeshes, streets: L.streets, cell: CELL, plazaRadius: PLAZA_R, envMat, ink: getOutlineMat() });
}
// What world.js sees: city.json, plus billboard copy from repos' own building.json (the owner's wins).
function worldConfig() {
  const cfg = cfgNow();
  const extra = (profileNow?.repos || []).filter((r) => buildingFile(r)?.billboard && !cfg?.repos[r.name]?.billboard);
  if (!extra.length) return cfg;
  const base = cfg || normalizeCityConfig({}).config;
  const repos = Object.assign(Object.create(null), base.repos);
  for (const r of extra) repos[r.name] = { ...repos[r.name], billboard: buildingFile(r).billboard };
  return { ...base, repos };
}
/**
 * The city's validated Gource View player settings (city.json "player"):
 * { music?: 'floating-cities' | 'deliberate-thought' | 'cipher' | 'digital-lemonade' | 'crypto' | 'none',
 *   volume?: integer 0-100 }. Empty when the developer set nothing.
 */
function cityPlayerSettings() {
  const p = cfgNow()?.player;
  return p ? { ...p } : {};
}
// The city.json fetch runs alongside the profile; validate it against the repos once both are in.
// The city waits at most CONFIG_WAIT_MS for it: if the answer is slow (network, or a main thread
// busy compiling shaders) the automatic city goes up and the file is applied when it lands
// (the fetch itself gives up at 12 s).
const CONFIG_WAIT_MS = 4000;
async function readCityConfig(pending, user, repos, version = cityVersion) {
  const res = await Promise.race([pending, new Promise((r) => setTimeout(r, CONFIG_WAIT_MS, null))]); // fetchCityConfig never throws
  if (res) { settleCityConfig(res, user, repos); return; }
  cityConfig = { login: user.login, found: false, error: null, warnings: [], published: null, config: null };
  pending.then((late) => {
    if (version !== cityVersion || customizer?.isOpen || customizer?.previewing) return;
    settleCityConfig(late, user, repos);
    if (cityConfig.config && profileNow?.user === user) rebuildForConfig();
  });
}
function settleCityConfig(res, user, repos) {
  let config = null, warnings = [], error = res.error;
  if (res.found && !error) {
    ({ config, warnings } = normalizeCityConfig(res.raw, { repos, login: user.login }));
    if (!config) error = warnings[0];
  }
  cityConfig = { login: user.login, found: res.found, error, warnings: config ? warnings : [], published: config, config };
  const where = `${user.login}/${user.login}/.git-city/city.json`;
  if (res.found && error) {
    console.warn(`[git-city] ${where} ignored: ${error}`);
    showToast(`city.json ignored: ${error}`, { tone: 'bad' });
  } else if (error) {
    console.warn(`[git-city] ${where}: ${error}`); // network trouble: the automatic city, quietly
  } else if (warnings.length) {
    console.warn(`[git-city] ${where}: ${warnings.length} setting(s) ignored\n- ${warnings.join('\n- ')}`);
    showToast(`city.json: ${warnings.length} setting${warnings.length === 1 ? '' : 's'} ignored. Open Customize for details.`, { tone: 'warn' });
  }
}
// Island + city for a profile under the current config. loadCity and the
// Customize preview share it, so a draft takes exactly the published path.
function applyProfile(user, repos, version = cityVersion) {
  profileNow = { user, repos };
  const cfg = cfgNow();
  setCityLayout(cityLayoutFor(user, repos));
  world.setProfile({ user, repos, config: worldConfig() }, cityLayout.city);
  // Neighbour portal gates at sea (neighbors.js): the developer's picks first, topped up automatically;
  // fire-and-forget, dropped if another city loaded meanwhile.
  fetchNeighbors(user.login, { repos, fallback: Object.keys(FIXTURES), pinned: cfg?.neighbours || [] })
    .then((list) => { if (version === cityVersion) world.setNeighbors(user.login, list); }).catch(() => {});
  const visible = buildCity(repos, user);
  explorer?.resetColliders(); // new buildings: re-box them (an active walk/drive keeps going, nudged clear)
  renderExplorer(user, visible);
  applyCityLook(cfg);
  loadBuildingConfigs(visible, version); // repos' own .git-city/building.json (top 16; cached)
  return visible;
}
// look / plane / island name. time, weather, tv and fx set how the city opens;
// the viewer's own choice returns in a city that doesn't set them, and the
// saved gc-tv / gc-fx preferences are never overwritten by a config.
function applyCityLook(cfg) {
  const look = cfg?.look || {};
  if (look.time) { viewerLook.dayMode ??= dayMode; setDayMode(look.time); }
  else if (viewerLook.dayMode) { setDayMode(viewerLook.dayMode); viewerLook.dayMode = null; }
  if (look.weather) { viewerLook.weather ??= weatherMode; setWeather(look.weather, $('weather-btn')); }
  else if (viewerLook.weather) { setWeather(viewerLook.weather, $('weather-btn')); viewerLook.weather = null; }
  const fx = look.fx ?? readPref('gc-fx') === '1';
  if (fx !== fxOn) setFx(fx, { remember: false });
  const tv = look.tv ?? readPref('gc-tv') === '1';
  if (tv !== tvOn) setTv(tv, { remember: false, animate: false });
  plazaFx?.setAccent(look.accent ? hexNum(look.accent) : null);
  explorer?.setLivery?.({ color: cfg?.plane?.color ? hexNum(cfg.plane.color) : null, name: cfg?.plane?.name || '' });
  const eyebrow = document.querySelector('#profile-head > .eyebrow');
  if (eyebrow) eyebrow.textContent = cfg?.island?.name || 'Profile explorer';
}
// Customize: a raw draft goes through the validator and the build exactly like a fetched file.
function rebuildForConfig() {
  const { user, repos } = profileNow;
  applyProfile(user, repos);
  buildCommitShuttles(repos, user);
  buildForkBeams(repos);
}
function previewCityConfig(draft) {
  if (!profileNow || !cityConfig) return [];
  const { config, warnings } = normalizeCityConfig(draft, { repos: profileNow.repos, login: profileNow.user.login });
  cityConfig = { ...cityConfig, config };
  rebuildForConfig();
  return warnings;
}
function restoreCityConfig() {
  if (!profileNow || !cityConfig) return;
  cityConfig = { ...cityConfig, config: cityConfig.published };
  rebuildForConfig();
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function resetCamera() {
  endTour();
  camGoal = null;
  orbitReturn = null;
  cine = null;
  controls.target.set(0, 10, 0);
  const extent = Math.max(24, ...buildingMeshes.map(b => Math.max(Math.abs(b.mesh.position.x), Math.abs(b.mesh.position.z)) + 6));
  const distance = Math.min(350, Math.max(120, extent * 3.0) / Math.min(1, camera.aspect));
  camera.position.copy(controls.target).add(new THREE.Vector3(1, 0.85, 1).normalize().multiplyScalar(distance));
  controls.update();
}

async function loadCity(login, { onBuilt } = {}) { // onBuilt(login): explore.js portal travel, fired once the new city stands
  login = login.trim().replace(/^@/, '');
  const version = ++cityVersion;
  currentLogin = login;
  const err = $('error');
  err.classList.remove('show');
  const loading = $('loading');
  loading.classList.remove('hidden');
  clearTimeout(play.autoplayTimer);
  play.playing = false; play.t = 0; play.lastIndex = -1;
  timeline = null;
  clearFeed();
  customizer?.reset(); // a different city: drop any Customize draft
  const configPending = fetchCityConfig(login, { timeout: 12000 }); // the developer's city.json, alongside the profile (never throws)
  try {
    const demo = new URLSearchParams(location.search).has('demo');
    let user, repos, sample = null;
    pinnedRepos = [];
    devTz = { offset: null };
    // Featured developers ship with a daily-refreshed snapshot: use it while it
    // is fresh (no API budget spent), otherwise go live and keep it as a fallback.
    if (FIXTURES[login]) {
      const fx = await loadFixture(login).catch(() => null);
      pinnedRepos = fx?.pinned || []; // even a stale snapshot still knows the pins
      if (fx?.tzOffset != null) devTz.offset = fx.tzOffset; // ...and the developer's UTC offset
      if (fx && (demo || Date.now() - Date.parse(fx.fetchedAt) < 48 * 3600e3)) { sample = fx; ({ user, repos } = fx); }
    }
    try {
      if (sample) { /* snapshot in hand */ }
      else if (demo) throw new Error('demo');
      else ({ user, repos } = await loadUser(login));
    } catch (e) {
      // Rate-limited (or ?demo=1): fall back to the bundled sample city.
      if (e.message === 'notfound') throw e;
      setLoadStatus('GitHub is rate-limiting us — loading sample data…');
      sample = await loadFixture(login);
      ({ user, repos } = sample);
      if (!demo) {
        err.innerHTML = `GitHub rate limit hit — showing a cached sample of <b>@${escapeHtml(user.login)}</b> instead. Try again in a minute.`;
        err.classList.add('show');
        setTimeout(() => { if (version === cityVersion) err.classList.remove('show'); }, 9000);
      }
    }
    if (version !== cityVersion) return;
    // The block's footprint and the island around it are generated from the
    // profile (same login, same city): shape from the login, biome from the
    // top language, attractions from fame.
    // The developer's city.json (if any) overrides those traits; a 404 is the automatic city.
    await readCityConfig(configPending, user, repos, version);
    if (version !== cityVersion) return;
    const visibleRepos = applyProfile(user, repos, version); // layout, island, neighbours, buildings, HUD, look
    const url = new URL(location.href);
    url.searchParams.set('user', user.login);
    history.replaceState(null, '', url);
    $('search-input').value = user.login;
    buildCommitShuttles(repos, user);
    buildForkBeams(repos);
    resetCamera();
    loading.classList.add('hidden');
    onBuilt?.(user.login); // explore.js portal travel: the new island is ready
    // Open on the showcase flight around the buildings (the activity playback is one press of ▶ away).
    if (!prefersReducedMotion() && new URLSearchParams(location.search).get('tour') !== '0') {
      setTimeout(() => { if (version === cityVersion && !explorer?.ownsCamera && !tour.active) startTour(); }, 1200);
    }
    // The activity timeline arrives second so the city never waits on it.
    const events = sample ? sample.events : await fetchEvents(user.login);
    if (version !== cityVersion) return;
    if (devTz.offset == null) {
      detectDevOffset(user.login, events).then((o) => {
        if (version === cityVersion && o != null) { devTz.offset = o; updateDevClock(); }
      });
    }
    buildRingFromEvents(events);
    setupTimeline(events, visibleRepos);
  } catch (e) {
    if (version !== cityVersion) return;
    loading.classList.add('hidden');
    if (e.message === 'notfound') {
      err.innerHTML = `Couldn't find <b>${escapeHtml(login)}</b> on GitHub. Try another username.`;
    } else {
      err.innerHTML = escapeHtml(e.message);
    }
    err.classList.add('show');
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function main() {
  initScene();
  buildEnvironment();
  world = createWorld(THREE, scene, { envMat, seededRandom, DISTRICT, CELL, slabHalf: SLAB_HALF, slabRadius: SLAB_R });
  // Explore modes (explore.js): walk / drive / fly. Wires the #explore-btn menu, keys 1-4 and its own HUD.
  explorer = createExplorer(THREE, {
    scene, camera, renderer, controls, envMat, ink: getOutlineMat(),
    heightAt: (x, z) => world.heightAt(x, z),
    colliders: () => buildingMeshes.flatMap(b => b.bodies), // building bodies, boxed once per city
    dayFactor: () => dayFactor,
    slabHalf: SLAB_HALF, slabRadius: SLAB_R, ringHalf: RING_R, ringCorner: RING_CORNER, cell: CELL, plazaRadius: PLAZA_R,
    layout: () => cityLayout, // live footprint (dist / contour / streets) for slab bounds and spawn points
    world: () => world, // portal gates at sea: gates / gateFor / arrival (world.js)
    // Portal travel: resolves { ok } once the neighbour's city is built. A login without a
    // featured snapshot is looked up first, so a rate-limited hop leaves this island intact.
    travel: async (login) => {
      const key = FIXTURES[login.toLowerCase()] ? login.toLowerCase() : login;
      if (!FIXTURES[key] && !new URLSearchParams(location.search).has('demo')) {
        try { await fetchJSON(`${API}/users/${encodeURIComponent(key)}`); }
        catch (e) { return { ok: false, reason: e.message === 'notfound' ? 'no such GitHub user' : 'GitHub rate limit' }; }
      }
      return new Promise((resolve) => {
        const failed = () => resolve({ ok: false, reason: 'the island failed to load' });
        loadCity(key, { onBuilt: (l) => resolve({ ok: true, login: l }) }).then(failed, failed); // first resolve wins
        $('loading').classList.add('hidden'); // the warp's cloud whiteout stands in for the loading screen
      });
    },
    onModeChange: (mode) => { if (mode !== 'orbit') { endTour(); camGoal = null; } setMenu(false); },
  });
  buildStreetlamps();
  buildFountain();
  buildPedestrians();
  buildWeather();
  buildActor();
  dust = buildDust(THREE, scene);
  wireUI();
  // Customize panel (customize.js): drafts preview through the same path as a fetched city.json.
  customizer = createCustomizer({
    context: () => (cityConfig && profileNow ? {
      login: profileNow.user.login, repos: profileNow.repos, found: cityConfig.found, error: cityConfig.error,
      warnings: cityConfig.warnings, published: cityConfig.published,
    } : null),
    preview: previewCityConfig,
    restore: restoreCityConfig,
    onOpen: () => { explorer?.setMode?.('orbit'); endTour(); setMenu(false); closePanel(); },
  });
  // Single hand-written fullscreen post pass (bloom + grade + grain).
  postPass = createPostPass(THREE, renderer, scene, camera, { bloom: 0.55 });
  crtPass = createCrtPass(THREE, renderer, scene, camera, {
    motion: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  });
  setDayMode('auto');
  const fromUrl = new URLSearchParams(location.search).get('user');
  const startUser = (fromUrl || DEFAULT_USER).replace(/^@/, '');
  document.getElementById('search-input').value = startUser;
  animate();
  loadCity(startUser);
  window.__city = { scene, world, camera, controls, explorer, get cityConfig() { return cityConfig; }, cityPlayerSettings, debug: { get orbitReturn() { return orbitReturn; }, get camGoal() { return camGoal; }, get tour() { return tour.active && { paused: tour.paused, stop: tour.stop, leg: tour.leg }; }, get cine() { return cine && { leg: cine.leg, legs: cine.legs.length }; } } }; // debug handle
}

main();
