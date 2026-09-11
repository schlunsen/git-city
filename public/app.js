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
import {
  fetchEvents, contributionDays, buildHeatmapRing, buildSky, createPostPass, buildDust,
} from './city-enhancements.js';
import {
  buildTimeline, paceTimeline, actorState, stepIndexAt, dailyHistogram, activityByRepo, dateParts,
} from './history.js';
import { createWorld, roundedRect, roundedRingGeometry } from './world.js';

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
let tour = { active: false, t: 0, duration: 28 };
let weatherMode = 'clear'; // 'clear' | 'rain' | 'snow'

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
  return { user: fx.user, repos: fx.repos, events, fetchedAt: fx.fetched_at };
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

// Distribute repos onto a BLOCKxBLOCK grid, ranked by stars. Ranks 0..11 sit
// in the inner ring closest to the plaza; the rest fill outward. Deterministic
// order so re-renders of the same data are stable.
function assignSlots(count) {
  const rings = [];
  const mid = (BLOCK - 1) / 2;
  for (let gx = 0; gx < BLOCK; gx++) {
    for (let gz = 0; gz < BLOCK; gz++) {
      const dist = Math.max(Math.abs(gx - mid), Math.abs(gz - mid)); // chebyshev
      rings.push({ gx, gz, dist });
    }
  }
  // Sort by ring distance, then by a fixed zigzag for variety.
  rings.sort((a, b) =>
    a.dist !== b.dist ? a.dist - b.dist : (a.gx + a.gz) - (b.gx + b.gz));
  return rings;
}

function worldForCell(gx, gz) {
  const mid = (BLOCK - 1) / 2;
  return {
    x: (gx - mid) * CELL,
    z: (gz - mid) * CELL,
  };
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
function assignDistricts(ranked) {
  const mid = (BLOCK - 1) / 2;
  const available = assignSlots().filter(({ gx, gz }) => {
    const { x, z } = worldForCell(gx, gz);
    // Reserve the complete plaza, including a building's half footprint.
    return Math.hypot(Math.max(0, Math.abs(x) - 3.2), Math.max(0, Math.abs(z) - 3.2)) > CELL * 1.7;
  });
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
    const anchor = { gx: mid + q.cx * 2, gz: mid + q.cz * 2 };
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    endTour();
    camGoal = null;
    controls.autoRotate = false;
    if (idleTimer) clearTimeout(idleTimer);
  });
  controls.addEventListener('end', () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!tour.active && flyover) controls.autoRotate = true; }, 4000);
  });

  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  pointerNDC = new THREE.Vector2();

  // ---- Lights -------------------------------------------------------------
  hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a1410, 0.5);
  scene.add(hemi);

  sun = new THREE.DirectionalLight(0xfff1d6, 1.3);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 70;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

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
}

// ---------------------------------------------------------------------------
// Static environment (ground, streets, plaza)
// ---------------------------------------------------------------------------
function buildEnvironment() {
  // The ground itself (island, water, hills) is built by world.js. Here we lay
  // the paved block: a rounded slab with a dark curb so it reads as one inked
  // shape sitting on the grass instead of a square tile dropped on a plane.
  const slab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(THREE, SLAB_HALF, SLAB_R), { depth: 0.6, bevelEnabled: false, curveSegments: 14 }),
    envMat(0x1a2230, 0xe3dccb));
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = -0.6; // extrudes upward: top face at y = 0
  slab.receiveShadow = true;
  cityGroup.add(slab);
  const curb = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(THREE, SLAB_HALF + 0.6, SLAB_R + 0.6), { depth: 0.5, bevelEnabled: false, curveSegments: 14 }),
    envMat(0x090c14, 0x2b3140));
  curb.rotation.x = -Math.PI / 2;
  curb.position.y = -0.58;
  cityGroup.add(curb);

  // --- Street grid (darker strips + dashed lane markings) ------------------
  // Streets run between cells, i.e. at half-integer positions in cell space.
  const streetMat = envMat(0x0e131c, 0x4a5468);
  const stripeMat = envMat(0x8a6a30, 0xf5cf4f, { emissive: 0x2a1c08 });
  const stripeGeom = new THREE.BoxGeometry(0.5, 0.06, 2.2);

  // Street centerlines sit at cell boundaries: x = (gx - (BLOCK-1)/2 - 0.5)*CELL
  // for gx = 0..BLOCK (i.e. the gaps between the BLOCK building cells, plus the
  // outer edges). Buildings occupy cell centers, so streets never cover them.
  // The outer ring is a boulevard with rounded corners (inked with its own
  // curb); the inner streets run between the ring's opposite sides.
  const boulevardCurb = new THREE.Mesh(
    roundedRingGeometry(THREE, RING_R + 2.0, RING_CORNER + 2.0, RING_R - 2.0, RING_CORNER - 2.0), envMat(0x090c14, 0x2b3140));
  boulevardCurb.position.y = 0.07;
  cityGroup.add(boulevardCurb);
  const boulevard = new THREE.Mesh(
    roundedRingGeometry(THREE, RING_R + 1.6, RING_CORNER + 1.6, RING_R - 1.6, RING_CORNER - 1.6), streetMat);
  boulevard.position.y = 0.085;
  cityGroup.add(boulevard);
  const straight = RING_R - RING_CORNER; // dashes only on the boulevard's straight runs
  for (let t = -straight + 2; t < straight - 1; t += 4.5) {
    for (const side of [RING_R, -RING_R]) {
      const s1 = new THREE.Mesh(stripeGeom, stripeMat);
      s1.rotation.y = Math.PI / 2; s1.position.set(t, 0.1, side); cityGroup.add(s1);
      const s2 = new THREE.Mesh(stripeGeom, stripeMat);
      s2.position.set(side, 0.1, t); cityGroup.add(s2);
    }
  }
  for (let i = 1; i < BLOCK; i++) {
    const p = (i - (BLOCK - 1) / 2 - 0.5) * CELL;
    // horizontal street (runs along X)
    const h = new THREE.Mesh(new THREE.BoxGeometry(DISTRICT, 0.08, 3.2), streetMat);
    h.position.set(0, 0.04, p);
    cityGroup.add(h);
    // vertical street (runs along Z)
    const v = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, DISTRICT), streetMat);
    v.position.set(p, 0.04, 0);
    cityGroup.add(v);
    // lane dashes along each street
    const dashes = BLOCK * 2;
    for (let k = 0; k < dashes; k++) {
      const t = -DISTRICT / 2 + (k + 0.5) * (DISTRICT / dashes);
      const s1 = new THREE.Mesh(stripeGeom, stripeMat);
      s1.rotation.y = Math.PI / 2;
      s1.position.set(t, 0.09, p);
      cityGroup.add(s1);
      const s2 = new THREE.Mesh(stripeGeom.clone(), stripeMat);
      s2.rotation.y = 0;
      s2.position.set(p, 0.09, t);
      cityGroup.add(s2);
    }
  }

  // --- Central plaza (circular, lighter stone) ------------------------------
  const plazaR = CELL * 1.7;
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(plazaR, plazaR, 0.12, 48),
    envMat(0x1f2837, 0xf0e9d8));
  plaza.position.y = 0.06;
  plaza.receiveShadow = true;
  cityGroup.add(plaza);

  // plaza ring inlay
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(plazaR - 1.4, 0.22, 8, 64),
    toonMat({ color: 0x64dedb, emissive: 0x1e5e5c }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  cityGroup.add(ring);

  // --- Plaza monument base (obelisk) — avatar floats above it ---------------
  const obelisk = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 2.6, 14, 4),
    toonMat({ color: 0x5a6378 }));
  obelisk.position.y = 7;
  obelisk.castShadow = true;
  cityGroup.add(obelisk);
  const obeliskHull = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.9, 14.4, 4), getOutlineMat());
  obeliskHull.raycast = () => {};
  obeliskHull.position.y = 7;
  cityGroup.add(obeliskHull);
  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.4, 1.4),
    toonMat({ color: 0x64dedb, emissive: 0x2c7a78 }));
  beacon.position.y = 14.6;
  cityGroup.add(beacon);
  cityGroup.userData.beacon = beacon;
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

  const ranked = [...repos]
    .filter(r => !r.fork && !r.archived)
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, MAX_BUILDINGS);

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

  const slots = assignDistricts(ranked);

  ranked.forEach((repo, i) => {
    const a = slots.assignments.find(x => x.repo === repo);
    if (!a) return;
    const { x, z } = worldForCell(a.gx, a.gz);
    const h = starsToHeight(repo.stargazers_count);
    const f = starsToFootprint(repo.stargazers_count);
    const color = LANG_COLORS[(repo.language || '').toLowerCase()] ?? FALLBACK_COLOR;
    createBuilding(repo, x, z, h, f, color);
  });

  buildDistrictSigns(THREE, slots.assignments);
  buildDistrictBaseplates(THREE, slots.assignments);

  // Vacant cells get a top-down decal (park, parking, court, site) so a small
  // profile still looks like a lived-in town instead of an empty grid.
  const used = new Set(slots.assignments.map(a => `${a.gx},${a.gz}`));
  const lots = [];
  for (let gx = 0; gx < BLOCK; gx++) for (let gz = 0; gz < BLOCK; gz++) {
    if (used.has(`${gx},${gz}`)) continue;
    const { x, z } = worldForCell(gx, gz);
    if (Math.hypot(Math.max(0, Math.abs(x) - 3.2), Math.max(0, Math.abs(z) - 3.2)) <= CELL * 1.7) continue; // plaza
    lots.push({ x, z, seed: hashStr(`${user.login}:${gx},${gz}`) });
  }
  world?.setLots(lots);

  buildAvatar(user);
  buildCars();
  return repos.filter(r => !r.fork && !r.archived).sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, MAX_BUILDINGS);
}

function createBuilding(repo, x, z, h, f, color) {
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
  const hip = tiers.length === 1 && h < 9 && rnd() > 0.45;

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
    const mat = toonMat({ color: 0xffffff, map, emissive: 0xffffff, emissiveMap, emissiveIntensity: 0 });
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
    if (tiers.length === 3) {
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
    const edge = new THREE.Vector3(pos.x, 0, pos.z).add(dir.multiplyScalar(CELL * 0.8));
    sign.position.set(edge.x, Math.max(13, (tallest.get(lang) || 0) * 1.08 + 5), edge.z);
    group.add(sign);
  }
  scene.add(group);
  districtSigns = { group };
}
function cellDist(gx, gz) {
  const mid = (BLOCK - 1) / 2;
  return Math.max(Math.abs(gx - mid), Math.abs(gz - mid));
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
  const mid = (BLOCK - 1) / 2;
  const ex = gx >= mid ? 1 : 0;
  const ez = gz >= mid ? 1 : 0;
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
function buildStreetlamps() {
  lampGroup = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6);
  const poleMat = toonMat({ color: 0x2a2f3a });
  const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
  const coneGeo = new THREE.ConeGeometry(1.1, 2.6, 20, 1, true);
  const headMat = toonMat({ color: 0x1a1a1a, emissive: 0xffd9a0, emissiveIntensity: 0.1 });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffe4b0, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
  const along = DISTRICT / 2 + 4;
  for (let i = 0; i <= 8; i++) {
    const x = -along + (i / 8) * along * 2;
    for (const z of [7.2, -7.2]) {
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

// Plaza fountain: a shader-animated water disc + droplet particles.
function buildFountain() {
  const g = new THREE.Group();
  // Basin ring
  const basin = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.4, 10, 32),
    new THREE.MeshStandardMaterial({ color: 0x3a4256, roughness: 0.6 }));
  basin.rotation.x = Math.PI / 2; basin.position.y = 0.4;
  g.add(basin);
  // Water disc with a small moving-normal shader (cheap ripple).
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x2f8fd6) } },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      float wave(vec2 p, float t){ return sin(p.x*8.0+t)*0.5+sin(p.y*9.0-t*1.3)*0.5; }
      void main(){
        float w = wave(vUv*3.0, uTime);
        float ring = smoothstep(0.0,0.15,distance(vUv,vec2(0.5)))*0.0+1.0;
        vec3 col = uColor * (0.8 + w*0.18);
        float a = 0.72 + w*0.08;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = 0.55;
  g.add(water);
  // Droplets
  const N = 120;
  const pos = new Float32Array(N * 3); const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i*3]=0; pos[i*3+1]=0.6; pos[i*3+2]=0; seed[i]=Math.random(); }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const droplets = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xbfe4ff, size: 0.12, transparent: true, opacity: 0.8 }));
  g.add(droplets);
  g.userData = { waterMat, droplets, seed, N };
  g.position.set(6, 0, 0);
  scene.add(g);
  fountain = { group: g, updateWater: (t) => { waterMat.uniforms.uTime.value = t; } };
}

// Tiny voxel pedestrians walking block-edge waypoints (InstancedMesh).
function buildPedestrians() {
  const N = 24;
  const bodyGeo = new THREE.BoxGeometry(0.35, 0.6, 0.35);
  const headGeo = new THREE.BoxGeometry(0.3, 0.28, 0.3);
  const bodyMat = toonMat({ color: 0xffffff });
  const headMat = toonMat({ color: 0xffd9b0 });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, N);
  const heads = new THREE.InstancedMesh(headGeo, headMat, N);
  const data = [];
  const ring = QUAD * CELL * 0.5;
  for (let i = 0; i < N; i++) {
    const lane = 6 + (i % 3) * 2.5; // a few concentric walking lanes
    data.push({ angle: Math.random() * Math.PI * 2, radius: lane + Math.random()*3, speed: (0.15 + Math.random()*0.25) * (Math.random()<0.5?1:-1), phase: Math.random()*6 });
  }
  scene.add(bodies, heads);
  pedestrians = { bodies, heads, data, N };
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

// Cinematic fly-through: scripted camera path, skippable.
function updateTour(dt) {
  tour.t += dt;
  const k = Math.min(1, tour.t / tour.duration);
  const e = k * k * (3 - 2 * k); // smoothstep
  // Keyframes: start high overview -> dive to plaza -> rise along a tower -> sweep boulevard at dusk
  const key = [
    { p: new THREE.Vector3(60, 48, 60), look: new THREE.Vector3(0, 6, 0) },
    { p: new THREE.Vector3(6, 6, 14),   look: new THREE.Vector3(0, 8, 0) },
    { p: new THREE.Vector3(18, 26, 10), look: new THREE.Vector3(6, 20, 6) },
    { p: new THREE.Vector3(40, 12, 30), look: new THREE.Vector3(0, 4, 0) },
  ];
  const seg = e * (key.length - 1);
  const i = Math.min(key.length - 2, Math.floor(seg));
  const f = seg - i;
  const p = key[i].p.clone().lerp(key[i+1].p, f);
  const look = key[i].look.clone().lerp(key[i+1].look, f);
  camera.position.copy(p);
  controls.target.copy(look);
  if (k >= 1) endTour();
}
function startTour() {
  tour.active = true; tour.t = 0;
  controls.autoRotate = false;
  if (document.getElementById('tour-btn')) document.getElementById('tour-btn').classList.add('on');
}
function endTour() {
  tour.active = false;
  if (document.getElementById('tour-btn')) document.getElementById('tour-btn').classList.remove('on');
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
    const r = size / 2 - 10;
    ctx.save();
    ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, 10, 10, size - 20, size - 20);
    ctx.restore();
    ctx.lineWidth = 9; ctx.strokeStyle = '#64dedb';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.stroke();
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
  const t = clock.elapsedTime;
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
// Cars (small colored boxes looping the main boulevard)
// ---------------------------------------------------------------------------
function buildCars() {
  for (const c of carGroup.children) { disposeObject(c); }
  carGroup.clear();
  const carColors = [0xe05252, 0x52a0e0, 0xe0c052, 0x70d070, 0xd070d0, 0xe08852];
  const carCount = 8;
  // Two lanes on the boulevard, one per direction, both hugging the rounded corners.
  const lanes = [
    { path: roundedRect(THREE, RING_R + 0.85, RING_CORNER + 0.85, THREE.Path), dir: 1 },
    { path: roundedRect(THREE, RING_R - 0.85, RING_CORNER - 0.85, THREE.Path), dir: -1 },
  ];
  for (let i = 0; i < carCount; i++) {
    const car = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.1, 1.2),
      toonMat({ color: carColors[i % carColors.length] }));
    car.castShadow = true;
    car.add(outlineBox(2.4, 1.1, 1.2, 0.18));
    const lane = lanes[i % 2];
    car.userData = { u: (i / carCount), speed: (0.22 + (i % 3) * 0.05) / (Math.PI * 2), lane };
    carGroup.add(car);
  }
}

function updateCars(dt) {
  for (const car of carGroup.children) {
    const d = car.userData;
    d.u = (d.u + d.speed * d.lane.dir * dt + 1) % 1;
    const p = d.lane.path.getPointAt(d.u), tan = d.lane.path.getTangentAt(d.u);
    car.position.set(p.x, 0.7, p.y);
    car.rotation.y = Math.atan2(-tan.y * d.lane.dir, tan.x * d.lane.dir);
  }
}

// ---- enhancement motion (all guarded, cheap) -----------------------------
function updateFountain() {
  if (!fountain) return;
  fountain.updateWater(clock.elapsedTime);
  // Animate droplet arcs around the basin.
  const { droplets, seed, N } = fountain.group.userData;
  const pos = droplets.geometry.attributes.position.array;
  for (let i = 0; i < N; i++) {
    const t = (clock.elapsedTime * 0.8 + seed[i]) % 1;
    const ang = seed[i] * Math.PI * 2;
    const r = t * 1.8;
    pos[i*3] = Math.cos(ang) * r;
    pos[i*3+1] = 0.6 + Math.sin(t * Math.PI) * 2.2;
    pos[i*3+2] = Math.sin(ang) * r;
  }
  droplets.geometry.attributes.position.needsUpdate = true;
}
function updatePedestrians(dt) {
  if (!pedestrians) return;
  const { bodies, heads, data, N } = pedestrians;
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const d = data[i];
    d.angle += d.speed * dt;
    const x = Math.cos(d.angle) * d.radius, z = Math.sin(d.angle) * d.radius;
    const bob = Math.sin(clock.elapsedTime * 6 + d.phase) * 0.05;
    m.makeTranslation(x, 0.75 + bob, z); bodies.setMatrixAt(i, m);
    m.makeTranslation(x, 1.25 + bob, z); heads.setMatrixAt(i, m);

  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
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
    pos[i*3] += Math.sin(clock.elapsedTime + data[i].drift) * dt * 2;
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
  const t = clock.elapsedTime;
  for (const b of forkBeams.beams) b.material.opacity = 0.3 + Math.sin(t * 2) * 0.15;
}

// ---------------------------------------------------------------------------
// Day / night cycle
// ---------------------------------------------------------------------------
function applyDayFactor(t) {
  // t in [0,1): 0 = midday, 0.5 = midnight.
  const elev = Math.cos(t * Math.PI * 2);           // 1 noon -> -1 midnight
  const day = THREE.MathUtils.clamp(elev, 0, 1);     // 0..1 daylight amount
  dayFactor = day;

  // Sun / moon
  sun.intensity = 0.15 + day * 1.35;
  moon.intensity = 0.08 + (1 - day) * 0.22;
  hemi.intensity = 0.45 + day * 0.8;

  // Sky dome + fog lerp: deep night blue -> warm daytime. The dome shader
  // paints the sky; we only lerp the fog color to match its horizon.
  if (skyDome) skyDome.setDay(day);
  const nightFog = new THREE.Color(0x0b111a);
  const dayFog = new THREE.Color(0xcfe4f4);
  const fog = nightFog.clone().lerp(dayFog, day);
  if (scene.fog) scene.fog.color.copy(fog);
  for (const e of envPalette) e.mat.color.copy(e.night).lerp(e.day, day);
  hemi.groundColor.setHex(0x1a1410).lerp(_tmpColor.setHex(0x5f9a58), day);
  world?.setDay(day);

  // Window emissive rises as daylight fades (full glow by night).
  const glow = Math.pow(1 - day, 1.6);
  // Lit panes come from each facade's emissive mask; a beam hit flares them.
  for (const b of buildingMeshes) {
    const flick = 0.92 + Math.sin(clock.elapsedTime * 0.7 + b.flicker) * 0.08;
    const inten = glow * flick * 1.15 + (b.pulse || 0) * 1.8;
    for (const m of b.bodyMats) m.emissiveIntensity = inten;
  }
  // "Office party" windows pulse a little above the base glow, and warm
  // windows get a faint per-building flicker so the skyline feels alive.
  for (const wp of windowPulse) {
    wp.mat.emissiveIntensity = glow * (0.9 + Math.sin(clock.elapsedTime * 3 + wp.phase) * 0.5);
  }
  // Streetlamps + plaza neon flare up at night; their light cones fade in too.
  if (lampGroup) {
    for (const l of lampGroup.children) l.userData.mat.emissiveIntensity = 0.1 + glow * 2.2;
    for (const cm of (lampGroup.userData.cones || [])) cm.opacity = glow * 0.22;
  }
  const beacon = cityGroup.userData.beacon;
  if (beacon) beacon.material.emissiveIntensity = 0.6 + glow * 1.2;
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
  if (onPointerDown._sx == null || e.button !== 0) return;
  const dx = e.clientX - onPointerDown._sx, dy = e.clientY - onPointerDown._sy;
  onPointerDown._sx = null;
  if (Math.hypot(dx, dy) > 6) return; // was a drag
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const bodies = buildingMeshes.flatMap(b => b.bodies);
  const hits = raycaster.intersectObjects(bodies, false);
  if (hits.length > 0) openPanel(hits[0].object.userData.building.repo);
  else closePanel();
}

function openPanel(repo) {
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
    ${repo.full_name ? `<a id="panel-gource" href="${GOURCE_VIEW}?repo=${encodeURIComponent(repo.full_name)}" target="_blank" rel="noopener"
      title="Replay this repository's commit history in Gource View">Watch its history in Gource View ↗</a>` : ''}`;
  panel.classList.add('open');
}
function closePanel() {
  document.getElementById('panel').classList.remove('open');
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
    <div class="row"><span>Top language</span><b>${topLang ? escapeHtml(prettify(topLang)) : '—'}</b></div>`;
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

function focusRepo(fullName) {
  const b = buildingByName.get(fullName);
  if (!b) return;
  endTour();
  openPanel(b.repo);
  const target = new THREE.Vector3(b.mesh.position.x, b.h * 0.55, b.mesh.position.z);
  const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
  if (dir.lengthSq() < 0.01) dir.set(1, 0, 1).normalize();
  dir.y = 0.6; dir.normalize();
  const position = target.clone().add(dir.multiplyScalar(Math.max(34, b.h * 1.8)));
  camGoal = { target, position };
}

function updateClock(step, index) {
  if (!step) {
    $('clk-day').textContent = '—'; $('clk-mon').textContent = '—'; $('clk-year').textContent = '';
    $('clk-sub').textContent = timeline?.steps.length ? 'press play to replay 90 days' : 'no public activity in the last 90 days';
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
  const from = dateParts(Date.now() - 89 * 86400000);
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

function setupTimeline(events, repos) {
  const names = buildingMeshes.map(b => b.repo.full_name).filter(Boolean);
  const built = buildTimeline(events, names);
  const { steps, duration } = paceTimeline(built.steps);
  timeline = { steps, duration, events, hist: dailyHistogram(events, 90), first: built.first, last: built.last };
  play.t = 0; play.lastIndex = -1; play.playing = false;
  clearFeed();
  renderActivityStrip();
  updateClock(null, -1);
  $('play-btn').disabled = steps.length === 0;
  $('scrub').disabled = steps.length === 0;
  updateTransport();
  $('hud-status').innerHTML = `${repos.length} repos · <span class="live">${steps.length} event${steps.length === 1 ? '' : 's'} · 90 days</span>`;
  const active = activityByRepo(steps);
  if (active.length) {
    renderTopCard('Most active', active.slice(0, 5).map(([name, n]) => ({
      full_name: name, name: name.split('/').pop(), language: buildingByName.get(name)?.repo.language, value: `${n} ev`,
    })), 'var(--accent)');
  }
}

function setDayMode(mode) {
  dayMode = mode;
  $('dn-label').textContent = { auto: 'Auto', cycle: 'Cycle', day: 'Day', night: 'Night' }[mode];
  $('daynight-btn').classList.toggle('on', mode === 'auto' || mode === 'cycle');
}
// Daylight from the viewer's local time: dark until ~05:30, full day 08:30–17:00,
// dusk until ~20:00. Mapped back onto applyDayFactor's phase (0 = noon).
function localClockPhase() {
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
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
    if (login) loadCity(login);
  });
  document.querySelectorAll('#examples a[data-user]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    loadCity(a.dataset.user);
  }));
  $('daynight-btn').addEventListener('click', () => {
    setDayMode({ auto: 'day', day: 'night', night: 'cycle', cycle: 'auto' }[dayMode]);
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
  const wxBtn = $('weather-btn');
  wxBtn.addEventListener('click', () => {
    const order = { clear: 'rain', rain: 'snow', snow: 'clear' };
    setWeather(order[weatherMode], wxBtn);
  });
  const fxBtn = $('fx-btn');
  fxBtn.classList.add('on');
  window.__fxOn = true;
  fxBtn.addEventListener('click', () => {
    fxBtn.classList.toggle('on');
    window.__fxOn = fxBtn.classList.contains('on');
  });
  // Transport
  $('play-btn').addEventListener('click', () => setPlaying(!play.playing));
  $('scrub').addEventListener('input', (e) => seekTo(Number(e.target.value) / 1000));
  document.querySelectorAll('.sp').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
  $('explorer').addEventListener('click', (e) => {
    const row = e.target.closest('[data-repo]');
    if (row && row.dataset.repo) focusRepo(row.dataset.repo);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable=true]')) return;
    if (e.key === 't' || e.key === 'T') { tour.active ? endTour() : startTour(); }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!play.playing); }
    else if (e.key === 'Escape') { endTour(); closePanel(); }
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
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Day/night: 'auto' follows the viewer's clock, 'cycle' is the 60s demo loop.
  if (dayMode === 'auto') {
    applyDayFactor(localClockPhase());
  } else if (dayMode === 'cycle') {
    const t = ((clock.elapsedTime % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS);
    applyDayFactor(t);
  } else if (dayMode === 'day') {
    applyDayFactor(0.0);
  } else {
    applyDayFactor(0.5);
  }

  updateCars(dt);
  updateFountain();
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
  world?.update(dt, clock.elapsedTime, camera, controls.target);
  if (dust) { dust.update(dt, clock.elapsedTime); dust.setNight(1 - dayFactor); }
  if (skyDome) skyDome.setTime(clock.elapsedTime);

  // Cinematic fly-through (drives the camera; OrbitControls paused while active)
  if (tour.active) updateTour(dt);

  if (!tour.active) {
    if (camGoal) {
      const k = 1 - Math.exp(-dt * 3);
      controls.target.lerp(camGoal.target, k);
      camera.position.lerp(camGoal.position, k);
      if (camera.position.distanceTo(camGoal.position) < 0.3) camGoal = null;
    } else if (follow && play.playing && actor) {
      // The orbit target drifts toward wherever the actor is working.
      const k = 1 - Math.exp(-dt * 1.4);
      controls.target.lerp(_v1.set(actor.pos.x * 0.7, Math.min(24, actor.pos.y * 0.5), actor.pos.z * 0.7), k);
    }
    controls.update();
  } else camera.lookAt(controls.target);
  districtSigns?.group.children.forEach(sign => sign.quaternion.copy(camera.quaternion));
  // Route every frame through the post pass when FX is enabled.
  if (postPass && window.__fxOn !== false) postPass.render(clock.elapsedTime, dayFactor);
  else renderer.render(scene, camera);
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
    if (o.geometry) o.geometry.dispose();
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
// Orchestration
// ---------------------------------------------------------------------------
function resetCamera() {
  endTour();
  camGoal = null;
  controls.target.set(0, 10, 0);
  const extent = Math.max(24, ...buildingMeshes.map(b => Math.max(Math.abs(b.mesh.position.x), Math.abs(b.mesh.position.z)) + 6));
  const distance = Math.min(350, Math.max(120, extent * 3.0) / Math.min(1, camera.aspect));
  camera.position.copy(controls.target).add(new THREE.Vector3(1, 0.85, 1).normalize().multiplyScalar(distance));
  controls.update();
}

async function loadCity(login) {
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
  try {
    const demo = new URLSearchParams(location.search).has('demo');
    let user, repos, sample = null;
    // Featured developers ship with a daily-refreshed snapshot: use it while it
    // is fresh (no API budget spent), otherwise go live and keep it as a fallback.
    if (FIXTURES[login]) {
      const fx = await loadFixture(login).catch(() => null);
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
    const visibleRepos = buildCity(repos, user);
    renderExplorer(user, visibleRepos);
    const url = new URL(location.href);
    url.searchParams.set('user', user.login);
    history.replaceState(null, '', url);
    $('search-input').value = user.login;
    buildCommitShuttles(repos, user);
    buildForkBeams(repos);
    resetCamera();
    loading.classList.add('hidden');
    // The activity timeline arrives second so the city never waits on it.
    const events = sample ? sample.events : await fetchEvents(user.login);
    if (version !== cityVersion) return;
    buildRingFromEvents(events);
    setupTimeline(events, visibleRepos);
    play.autoplayTimer = setTimeout(() => { if (version === cityVersion) setPlaying(true); }, 900);
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
  buildStreetlamps();
  buildFountain();
  buildPedestrians();
  buildWeather();
  buildActor();
  dust = buildDust(THREE, scene);
  wireUI();
  // Single hand-written fullscreen post pass (bloom + grade + grain).
  postPass = createPostPass(THREE, renderer, scene, camera, { bloom: 0.55 });
  setDayMode('auto');
  const fromUrl = new URLSearchParams(location.search).get('user');
  const startUser = (fromUrl || DEFAULT_USER).replace(/^@/, '');
  document.getElementById('search-input').value = startUser;
  animate();
  loadCity(startUser);
  window.__city = { scene, world, camera, controls }; // debug handle
}

main();
