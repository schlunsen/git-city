/*
 * Gitilla — render a GitHub profile as a 3D voxel metropolis.
 * Buildings = repos (height/footprint scale with stars, walls colored by language).
 * Central plaza holds an avatar monument; streets run between blocks; cars loop
 * the main boulevard; a 60s day/night cycle lights the windows.
 *
 * Vanilla JS + Three.js (ESM via import map). No build step.
 *
 * This file is the orchestrator: it loads a profile, builds the city from the
 * modules in ./city/, and runs the HUD, the activity timeline, input, day/night
 * and the render loop. The pieces:
 *   city/scene.js      renderer, camera, controls, lights, the world.js island
 *   city/layout.js     city footprint + lot math (pure, unit-tested)
 *   city/block.js      the paved block and streets    city/plaza.js     the town square
 *   city/buildings.js  repo buildings                 city/facade.js    facade painting
 *   city/overlays.js   per-profile heatmap ring, district signs, shuttles, fork beams
 *   city/townlife.js   lamps, fountain, townsfolk, weather   city/cars.js  traffic
 *   city/actor.js      the Gource-style avatar        city/tour.js      showcase tour + click flights
 *   city/gource-player.js  the history TV             city/hud.js       HUD cards + activity feed
 *   city/timezone.js   the developer's clock          city/readme.js    README excerpts
 *   city/data.js       GitHub + sample data           city/toon.js, util.js, constants.js  shared helpers
 */
import * as THREE from 'three';
import { fetchEvents, createPostPass, createCrtPass, buildDust } from './city-enhancements.js';
import { buildTimeline, paceTimeline, stepIndexAt, dailyHistogram, activityByRepo, dateParts } from './history.js';
import { createExplorer } from './explore.js'; // walk / drive / fly explore modes
import { fetchNeighbors } from './neighbors.js';
import { buildRepoSigns } from './repo-signs.js'; // repo names on every building (fascia + tower crowns)
import { buildWayfinding } from './wayfinding.js'; // repo-named street signs + the explore-mode name tag
import { fetchCityConfig, configRepo, normalizeCityConfig, fetchBuildingConfig, normalizeBuildingConfig, mergeBuildingConfig } from './city-config.js'; // city.json / building.json (validated, data only)
import { createCustomizer, showToast } from './customize.js'; // Customize panel: live preview + publish via GitHub's editor
import { API, DEFAULT_USER, FIXTURES, MAX_BUILDINGS, DAY_CYCLE_SECONDS, LANG_COLORS, FALLBACK_COLOR } from './city/constants.js';
import { $, escapeHtml, fmtNum, fmtBytes, setLoadStatus, disposeObject, readPref, writePref, hexNum, prefersReducedMotion } from './city/util.js';
import { getOutlineMat, envPalette, envMat, hashStr } from './city/toon.js';
import { planLots } from './city/lots.js';
import {
  CELL, SLAB_HALF, SLAB_R, RING_R, RING_CORNER, PLAZA_R, chooseCityShape, makeCityLayout, starsToHeight, starsToFootprint,
  setStreetWidth, STREET_DEFAULT,
  worldForCell, assignDistricts,
} from './city/layout.js';
import { fetchJSON, loadFixture, loadUser } from './city/data.js';
import {
  scene, camera, renderer, controls, clock, sun, moon, hemi, cityGroup, raycaster, pointerNDC, skyDome, world, initScene, initWorld,
} from './city/scene.js';
import { cityLayout, setCityLayout, buildEnvironment } from './city/block.js';
import { plazaFx, updatePlaza } from './city/plaza.js';
import { buildingMeshes, buildingByName, resetBuildings, createBuilding, tickBuildingFocus, focusGlowScale, refocusAfterRebuild } from './city/buildings.js';
import {
  districtSigns, clearPerUserEnhancements, buildRingFromEvents, buildDistrictSigns, buildDistrictBaseplates, buildCommitShuttles,
  buildForkBeams, updateShuttles, updateBeams,
} from './city/overlays.js';
import {
  lampGroup, weatherMode, buildStreetlamps, buildFountain, buildPedestrians, buildWeather, setWeather, updateFountain,
  updatePedestrians, updateWeather,
} from './city/townlife.js';
import {
  tour, cine, orbitReturn, initTour, updateTour, tourJump, tourToRepo, startTour, endTour, updateCine, flyToBuilding, returnToOrbit, cityFraming,
  pauseTourForUser, resumeTourAfterUser, cancelFlights,
} from './city/tour.js';
import { actor, initActor, buildActor, buildAvatar, updateActor } from './city/actor.js';
import { carKit, buildCars, updateCars } from './city/cars.js';
import { loadSponsors } from './city/sponsors.js';
import { gourceUrl, gourceCovering, openGource, closeGource, tuneGource, stopGource } from './city/gource-player.js';
import { devTz, setTimezoneSource, updateDevClock, detectDevOffset, localClockPhase } from './city/timezone.js';
import { renderExplorer, renderTopCard, announceStep, clearFeed } from './city/hud.js';
import { buildBannerPlane, updateBannerPlane, bannerPlaneHit, openSupport, bannerPlaneView, holdBannerPass, bannerPlaneFlying, summonBannerPlane, setPlaneSponsor, bannerNow } from './city/banner-plane.js'; // the Buy Me a Coffee sponsor plane

// ---------------------------------------------------------------------------
// App state (what the city modules own lives with them)
// ---------------------------------------------------------------------------
let hovered = null;
let dayFactor = 0;         // 0 = night, 1 = day (auto-cycles)
let dayMode = 'auto';      // 'auto' (local time) | 'day' | 'night' | 'cycle' (60s demo loop)
let postPass = null;       // createPostPass() handle (bloom / grade / grain)
let crtPass = null;        // createCrtPass() handle (old-TV look)
let fxOn = false;          // bloom/grade pass — off by default, the flat toon look reads better
let tvOn = false;          // old-television pass
let currentLogin = DEFAULT_USER;
let cityVersion = 0;
// city.json of the profile on screen: { login, found, error, warnings, published, config }.
// `config` is what the city shows: the published file, or a Customize draft
// while previewing (both normalizeCityConfig() output, or null).
let cityConfig = null;
let pinnedRepos = [];   // the profile's pinned repos, when a snapshot knows them (GraphQL needs a token)
let profileNow = null;     // { user, repos } on screen; the Customize preview rebuilds from it
let customizer = null;     // customize.js handle
const viewerLook = { dayMode: null, weather: null }; // the viewer's own choice while a city.json overrides it

// ---- Timeline state (Gource-style playback) --------------------------------
let dust = null;
const _tmpColor = new THREE.Color();
let timeline = null;         // { steps, duration, events, hist, first, last }
let play = { playing: false, t: 0, speed: 1, lastIndex: -1, autoplayTimer: null };
let flyover = true;          // slow idle orbit
let follow = true;           // orbit target drifts toward the actor while playing
let explorer = null;         // explore.js handle (walk / drive / fly); owns the camera while exploring
let wayfinding = null;       // wayfinding.js handle (street signs + name tag), rebuilt with the buildings
let swallowTap = false;      // set when a tap only dismissed the compact menu
let planeCam = null;         // clicking the sponsor plane: fly alongside it, read the banner, then the widget
let planeWatchWanted = 0;    // the coffee button asked for a flypast: wall-clock deadline to catch it
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (postPass) postPass.resize(window.innerWidth, window.innerHeight);
  if (crtPass) crtPass.resize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Embed mode  --  gitilla.com/?embed=1
// ---------------------------------------------------------------------------
// The city with nothing around it: no search bar, no transport, no cursor --
// just the place, flying itself. Written for the Git Visualizer screen saver,
// which used to paper over the interface from outside (inject CSS to hide the
// bars, then poll the toolbar and click the tour button every twelve seconds),
// and equally what you want when dropping the city into an iframe.
//
//   ?embed=1            a developer at random, chrome off, tours running
//   ?embed=1&user=x     ...that developer (a saver or a page's own playlist)
//   ?embed=1&users=a,b  ...from this pool instead of the bundled six
//   &tour=0             still turns the tours off
const PARAMS = new URLSearchParams(location.search);
// Bare ?embed counts; only an explicit 0/false turns it off.
const flag = (name) => { const v = PARAMS.get(name); return v !== null && v !== '0' && v !== 'false'; };
const EMBED = flag('embed');
const EMBED_MODE = EMBED ? embedMode() : 'tour'; // decided once, so a reload is a new draw
// The chrome goes before first paint. The loading overlay is covering the page
// at this point, so nothing is seen to disappear.
if (EMBED) {
  document.documentElement.dataset.embed = '1';
  // ?ui=none strips the cards too, leaving the city alone. Anything else keeps
  // them: they say whose city this is and what the camera is circling, which is
  // the part of the interface that is still doing something when nobody is there.
  const ui = (PARAMS.get('ui') || '').toLowerCase();
  if (ui) document.documentElement.dataset.ui = ui;
  // How many repositories a round visits before moving on, and whether it moves
  // on at all. ?stops=0 tours the whole city; ?islands=0 stays on this one.
  document.documentElement.dataset.stops = PARAMS.get('stops') ?? '5';
  // Note this one defaults ON, so it is not flag(): only an explicit 0/false stops it.
  const off = (name) => ['0', 'false'].includes((PARAMS.get(name) || '').toLowerCase());
  if (off('islands')) document.documentElement.dataset.islands = '0';
}
// The bundled six by default: their snapshots ship with the page, so an embed
// left running for hours keeps drawing cities long after GitHub's 60 requests
// an hour are gone.
// How an embed shows the city: the cinematic tour, the car driving the
// boulevard, or the plane circling overhead. Random by default, so a screen
// saver left on all day is not the same thirty seconds each time.
function embedMode() {
  // Declared inside: this is called while the module's own consts are still
  // being initialised, so anything at module scope would be in the dead zone.
  const NAMES = { tour: 'tour', car: 'drive', drive: 'drive', plane: 'fly', fly: 'fly', air: 'fly' };
  const asked = (PARAMS.get('mode') || 'random').toLowerCase();
  if (asked === 'random' || !asked) return ['tour', 'drive', 'fly'][Math.floor(Math.random() * 3)];
  return NAMES[asked] || 'tour';
}
function randomDeveloper() {
  const asked = (PARAMS.get('users') || '').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  const pool = asked.length ? asked : Object.keys(FIXTURES);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// City footprint (per profile)
// ---------------------------------------------------------------------------
// Pick the footprint for a profile: deterministic per login (and account
// year), big enough for every repo shown. ?city=round previews a shape.
const CITY_SHAPE_BY_PROFILE = true; // false: every city is square unless ?city= asks for a shape
function cityLayoutFor(user, repos) {
  const need = Math.max(1, rankRepos(repos).length); // repos hidden by city.json need no lot
  const seed = hashStr(`city-v1:${String(user?.login || '').toLowerCase()}:${String(user?.created_at || '').slice(0, 4)}`);
  const q = new URLSearchParams(location.search);
  const override = q.get('city') || cfgNow()?.island.shape; // ?city= preview, then city.json
  const shape = CITY_SHAPE_BY_PROFILE ? chooseCityShape(seed, override) : chooseCityShape(seed, override || 'square');
  // Street width decides the lot size and so which cells can hold a building:
  // it has to land before the layout is planned, not after.
  setStreetWidth(q.get('streets') ?? cfgNow()?.island.streets ?? STREET_DEFAULT);
  return makeCityLayout(shape, need, seed);
}

// ---------------------------------------------------------------------------
// Buildings (repos)
// ---------------------------------------------------------------------------
function buildCity(repos, user) {
  // Clear previous
  clearPerUserEnhancements();
  resetBuildings();
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

  // Vacant cells are planned by city/lots.js: themed zones, little squares
  // around intersections, decals + props — so a small profile still looks
  // like a lived-in town instead of an empty grid. The ragged edge of a
  // curved footprint gets lots too, wherever a decal fits.
  const used = new Set(slots.assignments.map(a => `${a.gx},${a.gz}`));
  const vacant = [];
  for (const c of L.cells) {
    if (!c.lot || used.has(`${c.gx},${c.gz}`)) continue;
    // Seeded by corner-based cell coords, as before, so a square city keeps its lots.
    vacant.push({ gx: c.gx, gz: c.gz, x: c.x, z: c.z, seed: hashStr(`${user.login}:${c.gx + L.hx},${c.gz + L.hz}`) });
  }
  world?.setLots(planLots(vacant, user.login, CELL));

  buildAvatar(user);
  setPlaneSponsor(user?.login); // headline sponsor's banner, on their island only
  buildCars(user);
  return rankRepos(repos).sort((a, b) => b.stargazers_count - a.stargazers_count); // what's built, tallest first
}

// ---------------------------------------------------------------------------
// Day / night cycle
// ---------------------------------------------------------------------------
// The interface belongs to the same sky as the island.
//
// A fixed-brightness interface over a world that has a night is the one thing
// in here that does not answer to the time of day: paper reads well over a
// sunny island and glares over a dark one. So the theme follows the light.
//
// The two thresholds are not a mistake. A single one would sit exactly where
// the sun does at dusk, and the whole interface would strobe between editions
// -- every frame of the 60-second cycle, and for real minutes at sunset. The
// gap means it takes a definite change in the sky to turn the page.
function syncThemeToSky() {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark';
  if (!dark && dayFactor < 0.10) root.dataset.theme = 'dark';
  else if (dark && dayFactor > 0.26) root.dataset.theme = 'paper';
}

function applyDayFactor(t) {
  // t in [0,1): 0 = midday, 0.5 = midnight.
  if (dayMode === 'sunset') t = 0.2; // city.json look.time "sunset": a fixed low sun (~30% daylight)
  const elev = Math.cos(t * Math.PI * 2);           // 1 noon -> -1 midnight
  const day = THREE.MathUtils.clamp(elev, 0, 1);     // 0..1 daylight amount
  dayFactor = day;
  syncThemeToSky();

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
    // …and drops away on tour-ghosted buildings, so lit panes don't blaze
    // through the fade (emissive is added on top of the faded albedo).
    const inten = (glow * flick * 1.15 + (b.pulse || 0) * 1.8) * focusGlowScale(b);
    for (const m of b.bodyMats) m.emissiveIntensity = inten;
  }
  // Streetlamps + plaza neon flare up at night; their light cones fade in too.
  if (lampGroup) {
    for (const l of lampGroup.children) l.userData.mat.emissiveIntensity = 0.1 + glow * 2.2;
    for (const cm of (lampGroup.userData.cones || [])) cm.opacity = glow * (cm.userData.peak ?? 0.22);
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
  const tip = document.getElementById('tooltip');
  if (bannerPlaneHit(raycaster)) { // the sponsor plane and its banner
    if (hovered !== 'plane') {
      hovered = 'plane';
      tip.textContent = '\u2615 Enjoying Gitilla? Click to fly alongside';
      tip.classList.add('show');
      document.body.style.cursor = 'pointer';
    }
    positionTooltip(cx, cy);
    return;
  }
  const bodies = buildingMeshes.flatMap(b => b.bodies);
  const hits = raycaster.intersectObjects(bodies, false);
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
  if (planeCam) releasePlaneCam(); // a drag hands the camera straight back
  // Only treat as a click if not a drag: we approximate by checking that the
  // pointer hasn't moved much since the last move event (OrbitControls also
  // handles drags). We just raycast on pointerup with a small delta guard.
  onPointerDown._sx = e.clientX; onPointerDown._sy = e.clientY;
}
// Fly alongside the sponsor plane so its banner can be read, then offer the coffee.
const PLANE_WATCH_MAX = 14;
const _pcEye = new THREE.Vector3(), _pcLook = new THREE.Vector3();
// Ride along with the plane, if there is a pass to ride. A click lengthens it.
function startPlaneWatch() {
  if (explorer?.ownsCamera) return false;               // walk / drive / fly own the camera
  if (!holdBannerPass(PLANE_WATCH_MAX + 1)) return false; // keep the full camera climb within the pass
  endTour();
  if (!planeCam) planeCam = { home: { position: camera.position.clone(), target: controls.target.clone(), autoRotate: controls.autoRotate }, t: 0, phase: 'watch' };
  controls.autoRotate = false;
  return true;
}
function watchPlane() {          // clicking the plane in the city
  openSupport();                 // the coffee panel opens straight away ...
  startPlaneWatch();             // ... and we fly alongside if the pass is still on
}
// The widget's own button, bottom left. It opens its panel itself; we add the
// flypast, summoning the plane if it is resting between passes.
function coffeeButtonPressed() {
  if (startPlaneWatch()) return;
  if (summonBannerPlane()) planeWatchWanted = performance.now() + 30000;
}
// openSupport() presses that button in code, so only react to a real click.
function hookCoffeeButton() {
  let tries = 0;
  const attach = () => {
    const btn = document.getElementById('bmc-wbtn');
    if (btn) {
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Support Gitilla on Buy Me a Coffee');
      btn.tabIndex = 0;
      btn.addEventListener('click', (e) => { if (e.isTrusted) coffeeButtonPressed(); });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        btn.click();
        coffeeButtonPressed();
      });
      return true;
    }
    return ++tries > 60;         // the widget is an external script: give it 30s to turn up
  };
  if (attach()) return;
  const iv = setInterval(() => { if (attach()) clearInterval(iv); }, 500);
}
function releasePlaneCam() {
  if (!planeCam) return;
  controls.autoRotate = planeCam.home.autoRotate;
  planeCam = null;
}
function updatePlaneCam(dt) {
  const pc = planeCam;
  pc.t += dt;
  const live = bannerPlaneView(_pcEye, _pcLook, pc.t);
  if (pc.phase === 'watch' && (!live || pc.t > PLANE_WATCH_MAX)) { // the pass is over: drift home
    pc.phase = 'back';
    pc.t = 0;
    pc.fromPos = camera.position.clone();
    pc.fromTgt = controls.target.clone();
  }
  if (pc.phase === 'back') {
    const u = Math.min(1, pc.t / 1.6), e = u * u * (3 - 2 * u);
    camera.position.lerpVectors(pc.fromPos, pc.home.position, e);
    controls.target.lerpVectors(pc.fromTgt, pc.home.target, e);
    if (u >= 1) releasePlaneCam();
    return true;
  }
  const k = 1 - Math.exp(-dt * (pc.t < 1.2 ? 2.8 : 6)); // swing in, then follow the gently drifting viewpoint
  camera.position.lerp(_pcEye, k);
  controls.target.lerp(_pcLook, k);
  return true;
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
  if (bannerPlaneHit(raycaster)) { watchPlane(); return; } // the sponsor plane: fly alongside, then the coffee
  const bodies = buildingMeshes.flatMap(b => b.bodies);
  const hits = raycaster.intersectObjects(bodies, false);
  if (hits.length > 0) visitRepo(hits[0].object.userData.building, { x: e.clientX, y: e.clientY });
  else { closePanel(); if (!tour.active) closeVisit(); }
}

// Clicking a building is a one-repo tour stop: the camera arcs over and circles
// it, the field guide arrives on the right, and the corner screen replays its
// commit history — the same arrival city/tour.js gives a tour stop, and the same
// guide walking or driving up to a building opens with E.
let visitChaining = false; // a click straight from one building to the next
// The opening showcase flight is on a timer. Clicking a building in the meantime
// is the visitor saying where they want to look, so the flight is called off
// rather than hijacking the camera ten seconds into their reading.
let autoTourTimer = null;
function cancelAutoTour() { clearTimeout(autoTourTimer); autoTourTimer = null; }
function visitRepo(building, at) {
  cancelAutoTour(); // they picked a building themselves; do not fly them away from it
  const repo = building.repo;
  ensureBuildingConfig(repo); // its .git-city/building.json (restyles the building when it lands)
  if (isCompact()) { setMenu(false); setProfile(false); }
  // Ends any tour (and so closes an open guide) first, so nothing flies on
  // mid-read. That close must not also fly back to the orbit we are leaving.
  visitChaining = true;
  flyToBuilding(building);
  visitChaining = false;
  const opened = explorer?.inspectRepo(repo, {
    status: 'ORBITING',
    resumeLabel: 'Back to the city ',
    note: 'The camera circles this building while you read.',
    modal: false,
    onClose: () => { if (!visitChaining) returnToOrbit(); },
  });
  // No explorer yet (a very early click): the old side panel and player still work.
  if (!opened) { openPanel(repo); if (repo.full_name) openGource(repo, at); }
}
function closeVisit() {
  if (!explorer?.inspectorOpen) return false;
  explorer.closeInspector();
  return true;
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

// ---------------------------------------------------------------------------
// HUD: transport, menus, FX / TV / day-night settings, wiring
// ---------------------------------------------------------------------------
function focusRepo(fullName) {
  const b = buildingByName.get(fullName);
  if (b) visitRepo(b);
}

function updateClock(step) {
  if (!step) {
    $('play-date').textContent = '—';
    return;
  }
  const d = dateParts(step.ts);
  $('play-date').textContent = d.iso;
}

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
  if (on) controls.autoRotate = flyover;
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
  $('support-btn').addEventListener('click', () => { setMenu(false); watchPlane(); });
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
    else if (e.key === 'Escape') { endTour(); closePanel(); closeVisit(); setMenu(false); setProfile(false); }
    else if (e.key === 'v' || e.key === 'V') { setTv(!tvOn, { remember: cfgNow()?.look.tv === undefined }); }
  });
  hookCoffeeButton(); // the Buy Me a Coffee button flies you to the plane too
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
  updateBannerPlane(dt, clock.getElapsed(), !!explorer?.game?.active); // hidden during the bomb run
  if (planeWatchWanted) { // the coffee button asked for a flypast: climb aboard when it arrives
    if (bannerPlaneFlying()) { planeWatchWanted = 0; startPlaneWatch(); }
    else if (performance.now() > planeWatchWanted) planeWatchWanted = 0;
  }
  updateFountain(dayFactor);
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
  wayfinding?.update(dt, clock.getElapsed(), camera, dayFactor, explorer?.game?.active ? 'orbit' : explorer?.mode); // street signs dim at night; tag follows explore modes (not during the bomb run)
  if (dust) { dust.update(dt, clock.getElapsed()); dust.setNight(1 - dayFactor); }
  if (skyDome) skyDome.setTime(clock.getElapsed());

  // Explore modes (explore.js) drive the camera while active (and while gliding
  // back to orbit): the tour, click flights, follow and controls.update() stand down.
  const exploring = explorer ? explorer.update(dt, clock.getElapsed()) : false;
  if (exploring && planeCam) releasePlaneCam(); // explore modes own the camera
  const watching = !exploring && !!planeCam && updatePlaneCam(dt); // flying alongside the sponsor plane
  // Cinematic fly-through (drives the camera; OrbitControls paused while active)
  const touring = tour.active && !tour.paused;
  if (watching) { /* the plane camera placed it this frame */ }
  else if (touring && !exploring) updateTour(dt);
  else if (cine && !exploring) updateCine(dt); // click-a-building flight in / out
  tickBuildingFocus(dt); // ease the tour focus fade even while the user holds the camera
  const scripted = touring || !!cine || watching;

  if (exploring) { /* explore.js placed the camera this frame */ }
  else if (!scripted) {
    if (follow && play.playing && actor) {
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
// City config: the developer's <login>/<login>/.git-city/city.json. city-config.js
// fetches + validates it; this only reads the normalised result. Data only:
// its text reaches the page through fillText / textContent.
// ---------------------------------------------------------------------------
const cfgNow = () => cityConfig?.config || null;
// GitHub organizations get their own events, neighbours (public members) and city.json home (<org>/.github).
const isOrg = (user) => user?.type === 'Organization';
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
    // A timeout or network error isn't an answer (a busy first frame can starve a 3 s fetch):
    // forget it, so a retry, a click or the tour asks again. 404s and real files are kept.
    if (!res.found && res.error) { buildingFiles.delete(key); return false; }
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
// Which building.json files a city fetches up front: featured (city.json) and pinned repos first,
// the order the tour visits them, then the most-starred; de-duplicated, at most BUILDING_PREFETCH_MAX.
const BUILDING_PREFETCH_MAX = 24;
function loadBuildingConfigs(visible, version) {
  const byName = new Map(visible.filter(r => r.full_name).map(r => [String(r.name).toLowerCase(), r]));
  const picks = new Set();
  for (const n of [...(cfgNow()?.featured || []), ...pinnedRepos]) { const r = byName.get(String(n).toLowerCase()); if (r) picks.add(r); }
  for (const r of [...byName.values()].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, BUILDING_PREFETCH)) picks.add(r);
  const list = [...picks].slice(0, BUILDING_PREFETCH_MAX);
  const pass = (repos, retry) => Promise.all(repos.map(fetchBuildingFor)).then((set) => {
    if (version !== cityVersion) return;
    const hits = repos.filter((r, i) => set[i]);
    if (hits.length) refreshBuildings(hits);
    // Requests that timed out or failed (not 404s) get one more try once the city has settled.
    const again = repos.filter((r) => !buildingFiles.has(String(r.full_name).toLowerCase()));
    if (retry && again.length) setTimeout(() => { if (version === cityVersion) pass(again, false); }, 4000);
  });
  pass(list, true);
}
// A clicked building, or the tour's next stop: fetch its file if nobody has yet.
// Takes a repo or a building entry ({ repo, mesh }); cached, so calling it per stop is cheap.
function ensureBuildingConfig(target) {
  const repo = target?.mesh && target?.repo ? target.repo : target;
  if (!repo?.full_name) return;
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
  refocusAfterRebuild(); // the tour may be mid-stop: its focus just got disposed
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
  cityConfig = { login: user.login, repo: null, found: false, error: null, warnings: [], published: null, config: null };
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
  cityConfig = { login: user.login, repo: res.repo || null, found: res.found, error, warnings: config ? warnings : [], published: config, config };
  const where = `${res.repo || `${user.login}/${user.login}`}/.git-city/city.json`;
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
  fetchNeighbors(user.login, { repos, fallback: Object.keys(FIXTURES), pinned: cfg?.neighbours || [], org: isOrg(user) })
    .then((list) => { if (version === cityVersion) world.setNeighbors(user.login, list); }).catch(() => {});
  const visible = buildCity(repos, user);
  explorer?.resetColliders(); // new buildings: re-box them (an active walk/drive keeps going, nudged clear)
  renderExplorer(user, visible);
  applyCityLook(cfg);
  // Repos' own .git-city/building.json (featured, pinned, top-starred; cached). Wait until the
  // browser is idle after the first heavy frames, so the fetches aren't starved into timeouts.
  const startBuildingConfigs = () => { if (version === cityVersion) loadBuildingConfigs(visible, version); };
  if ('requestIdleCallback' in window) requestIdleCallback(startBuildingConfigs, { timeout: 2500 });
  else setTimeout(startBuildingConfigs, 1500);
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
  if (eyebrow) eyebrow.textContent = cfg?.island?.name || (isOrg(profileNow?.user) ? 'Organization explorer' : 'Profile explorer');
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
  cancelFlights();
  const { target, position } = cityFraming();
  controls.target.copy(target);
  camera.position.copy(position);
  controls.update();
}

async function loadCity(login, { onBuilt } = {}) { // onBuilt(login): explore.js portal travel, fired once the new city stands
  login = login.trim().replace(/^@/, '');
  const version = ++cityVersion;
  cancelAutoTour(); // a pending flight belongs to the city we are leaving
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
  await loadSponsors(); // one small same-origin file, fetched once per page; never throws
  try {
    const demo = new URLSearchParams(location.search).has('demo');
    let user, repos, sample = null;
    pinnedRepos = [];
    devTz.offset = null;
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
    explorer?.revealCity(); // the same light-and-warp language as island travel and the README
    onBuilt?.(user.login); // explore.js portal travel: the new island is ready
    // Open on the showcase flight around the buildings (the activity playback is one press of ▶ away).
    // An embed is nothing but the flight, so it starts sooner; reduced motion
    // is a preference about interfaces the visitor is driving, and this one was
    // asked for -- in System Settings, or in the URL -- to move on its own.
    if (EMBED && EMBED_MODE !== 'tour') {
      // Hand the city to a vehicle instead. setMode ends any tour for us, and
      // the autopilot moves the same sticks a driver would, so the car still
      // collides and the plane still keeps itself off the rooftops.
      setTimeout(() => {
        if (version !== cityVersion) return;
        explorer?.setMode(EMBED_MODE);
        explorer?.setAutopilot(true);
      }, 2500);
    } else if (PARAMS.get('tour') !== '0' && (EMBED || !prefersReducedMotion())) {
      autoTourTimer = setTimeout(() => { if (version === cityVersion && !explorer?.ownsCamera && !explorer?.inspectorOpen && !tour.active) startTour(); },
        EMBED ? 2500 : 10000); // a look around first
    }
    // The activity timeline arrives second so the city never waits on it.
    const events = sample ? sample.events : await fetchEvents(user.login, { org: isOrg(user) });
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
  // Dragging hands the camera to the user: the tour pauses and the idle orbit waits.
  let idleTimer = null;
  initScene({
    onControlStart() {
      pauseTourForUser();
      controls.autoRotate = false;
      if (idleTimer) clearTimeout(idleTimer);
    },
    onControlEnd() {
      resumeTourAfterUser();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (!tour.active && flyover) controls.autoRotate = true; }, 4000);
    },
  });
  window.addEventListener('resize', onResize);
  // What the city modules read from here (getters, so they stay live across cities).
  initTour({
    featured: () => cfgNow()?.featured || [], pinned: () => pinnedRepos, openPanel, prefetch: ensureBuildingConfig,
    inspect: (repo, options) => explorer?.inspectRepo(repo, options) || false,
    closeInspect: () => explorer?.closeInspector(),
    transitInspect: (repo) => explorer?.transitInspector(repo) || false,
    guideOpen: () => !!explorer?.inspectorOpen,
    stopGource, // the corner history screen stops with the tour
    nextIsland: () => explorer?.flyToNext(), // embed: a finished round sails on to a neighbour
    explorer: () => explorer, flyover: () => flyover,
  });
  initActor({ version: () => cityVersion, playback: () => ({ timeline, play }), onStep: announceStep, onClock: updateClock });
  setTimezoneSource(() => cfgNow()?.look?.timezone);
  buildEnvironment();
  initWorld();
  // Explore modes (explore.js): walk / drive / fly. Wires the #explore-btn menu, keys 1-4 and its own HUD.
  explorer = createExplorer(THREE, {
    scene, camera, renderer, controls, envMat, ink: getOutlineMat(),
    heightAt: (x, z) => world.heightAt(x, z),
    colliders: () => buildingMeshes.flatMap(b => b.bodies), // building bodies, boxed once per city
    dayFactor: () => dayFactor,
    // Whatever the field guide is showing, the corner screen replays its history.
    onRepo: (repo) => (repo ? tuneGource(repo) : stopGource()),
    // Getters: island.streets moves the cell, and the explorer outlives a city.
    slabHalf: () => SLAB_HALF, slabRadius: SLAB_R, ringHalf: () => RING_R, ringCorner: RING_CORNER, cell: () => CELL, plazaRadius: () => PLAZA_R,
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
    buildings: () => buildingMeshes, // bomb run targets (game.js); the city is restored from snapshots on exit
    login: () => currentLogin,       // best score per island
    onGameStart: () => { endTour(); closePanel(); closeGource(); }, // the bomb run takes the screen
    tourToRepo: (fullName) => tourToRepo(fullName), // end-card repo links: tour straight to that building
    onModeChange: (mode) => { if (mode !== 'orbit') endTour(); setMenu(false); },
  });
  buildStreetlamps(cityLayout);
  buildFountain();
  buildPedestrians();
  buildWeather();
  buildActor();
  buildBannerPlane();
  dust = buildDust(THREE, scene);
  wireUI();
  // Customize panel (customize.js): drafts preview through the same path as a fetched city.json.
  customizer = createCustomizer({
    context: () => (cityConfig && profileNow ? {
      login: profileNow.user.login, org: isOrg(profileNow.user), repos: profileNow.repos, found: cityConfig.found, error: cityConfig.error,
      configRepo: cityConfig.repo || configRepo(profileNow.user.login, { org: isOrg(profileNow.user) }), // where city.json lives (or should)
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
  const fromUrl = PARAMS.get('user');
  const startUser = (fromUrl || (EMBED ? randomDeveloper() : DEFAULT_USER)).replace(/^@/, '');
  document.getElementById('search-input').value = startUser;
  animate();
  loadCity(startUser);
  // A showcase tour ends at its last stop. With nobody there to start another,
  // the city would stand still for the rest of the scene -- so watch for it.
  if (EMBED && EMBED_MODE === 'tour' && PARAMS.get('tour') !== '0') {
    setInterval(() => {
      if (!document.getElementById('loading')?.classList.contains('hidden')) return; // still being built
      if (tour.active || explorer?.ownsCamera || explorer?.inspectorOpen) return;
      startTour();
    }, 6000);
  }
  window.__city = { scene, world, camera, controls, explorer, get cityConfig() { return cityConfig; }, cityPlayerSettings, get buildingFiles() { return buildingFiles; }, debug: { get orbitReturn() { return orbitReturn; }, get tour() { return tour.active && { paused: tour.paused, stop: tour.stop, leg: tour.leg }; }, get cine() { return cine && { leg: cine.leg, legs: cine.legs.length }; }, get banner() { return bannerNow(); } } }; // debug handle
}

main();
