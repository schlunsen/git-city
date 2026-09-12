/*
 * Camera scripts: the showcase tour (the default way into a city, with its
 * mini-TV card) and the click-a-building flight in and back out to the orbit.
 */
import * as THREE from 'three';
import { camera, controls } from './scene.js';
import { buildingMeshes, buildingByName, setFocusedBuilding } from './buildings.js';
import { readmeExcerpt, readmeKnown } from './readme.js';
import { langHex } from './constants.js';
import { fmtNum } from './util.js';

export const tour = { active: false, paused: false, t: 0, legs: null, leg: 0, card: null, stops: null, stop: 0 }; // showcase flight (see updateTour)
// What the tour needs from app.js, handed over once (initTour): the city.json
// featured list and the profile's pinned repos (tour order), the repo panel, the
// building.json prefetch, the explorer (it may own the camera) and the idle-orbit setting.
let deps = { featured: () => [], pinned: () => [], openPanel() {}, prefetch() {}, explorer: () => null, flyover: () => true };
export function initTour(d) { deps = { ...deps, ...d }; }

// Showcase flight — the default way into a city. The camera flies from
// building to building (most-starred first), circles each one while a name
// card shows, and every few stops swoops out over the island. It loops until
// you take the controls (drag, scroll, click), and T / Tour toggles it.

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
    dur, loop, repo: b.repo, b,
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
  for (const n of deps.featured()) add(byName.get(String(n).toLowerCase()), 'featured');
  for (const n of deps.pinned()) add(byName.get(String(n).toLowerCase()), 'pinned');
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
    if (leg.repo) Object.assign(fly, { repo: leg.repo, b: leg.b, stop: leg.stop, of: leg.of, highlight: leg.highlight, next: true }); // announce the next repo on the way
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
export function updateTour(dt) {
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
  setFocusedBuilding(leg.repo ? leg.b || null : null); // the city fades back behind the stop in focus
}
// Jump the showcase to the next (+1) / previous (-1) repo, or back to the
// current one (0, after the user looked around): fly there from wherever the camera is.
export function tourJump(dir) {
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
  // Repo-level .git-city/building.json: load it for this stop and the next, so
  // graffiti, roofs and neon are up before the camera arrives.
  deps.prefetch(repo); if (upcoming) deps.prefetch(upcoming);
  el.classList.add('show');
  if (!sameRepo) { el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); } // CRT channel change
}

// Start (or steer) the showcase tour at one repo, e.g. from the bomb-run results
// list: it flies there and carries on through the rest of the city from that stop.
export function tourToRepo(fullName) {
  if (!tour.active) startTour();
  if (!tour.stops) buildShowcase(); // fixes the stop list
  const i = tour.stops ? tour.stops.findIndex((b) => b.repo.full_name === fullName) : -1;
  if (i < 0) { // not a tour stop: just fly to it and open its panel
    const b = buildingByName.get(fullName);
    if (b) { endTour(); deps.openPanel(b.repo); flyToBuilding(b); }
    return;
  }
  tour.stop = i;
  tourJump(0);
}
export function startTour() {
  tour.active = true; tour.paused = false; tour.t = 0; tour.leg = 0; tour.legs = null; tour.stops = null; tour.stop = 0;
  controls.autoRotate = false;
  document.getElementById('tour-btn')?.classList.add('on');
}
export function endTour() {
  tour.active = false; tour.paused = false; tour.legs = null; tour.stops = null;
  showcaseCard(null);
  setFocusedBuilding(null);
  document.getElementById('tour-btn')?.classList.remove('on');
}

// Clicking a building (or a repo in the lists) flies the camera to it; closing
// the repo panel (✕, Esc, or a click on empty ground) flies back to where you
// were orbiting and resumes the orbit.
export let orbitReturn = null;
let tourResumeTimer = 0;
// A short camera script (same legs as the showcase): { legs, leg, t, onDone }.
export let cine = null;
export function updateCine(dt) {
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
export function flyToBuilding(b) {
  if (deps.explorer()?.ownsCamera) return; // walk / drive / fly own the camera
  endTour();
  if (!orbitReturn) orbitReturn = { target: controls.target.clone(), position: camera.position.clone(), autoRotate: controls.autoRotate };
  controls.autoRotate = false;
  // Arc up over the rooftops into a framing orbit, then circle slowly while its panel is open.
  const circle = orbitLeg(b, Math.atan2(camera.position.z, camera.position.x), { dur: 40, sweep: Math.PI * 2, loop: true });
  cine = { legs: [flyLeg(camera.position, controls.target, circle.pos(0, new THREE.Vector3()), circle.look(0, new THREE.Vector3()), 2.6), circle], leg: 0, t: 0 };
}
export function returnToOrbit() {
  if (!orbitReturn || deps.explorer()?.ownsCamera) { orbitReturn = null; cine = null; return; }
  const back = orbitReturn, resume = back.autoRotate || deps.flyover();
  orbitReturn = null;
  cine = { legs: [flyLeg(camera.position, controls.target, back.position, back.target, 2.6)], leg: 0, t: 0,
    onDone: () => { controls.autoRotate = resume; } };
}
// The user grabbed the camera: the tour pauses where it is, and any flight stops.
export function pauseTourForUser() {
  if (tour.active) tour.paused = true; // look around; the tour picks up again when you let go
  setFocusedBuilding(null); // the camera is yours: the city comes back to full
  if (tourResumeTimer) clearTimeout(tourResumeTimer);
  cine = null;
}
// ...and let go: a paused tour flies back to its stop after a moment.
export function resumeTourAfterUser() {
  if (tour.active && tour.paused) tourResumeTimer = setTimeout(() => { if (tour.active && tour.paused) tourJump(0); }, 2500);
}
// A camera reset: forget any flight in progress and where it would return to.
export function cancelFlights() {
  orbitReturn = null;
  cine = null;
}
