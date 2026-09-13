/*
 * Camera scripts: the showcase tour (the default way into a city, with its
 * mini-TV card) and the click-a-building flight in and back out to the orbit.
 */
import * as THREE from 'three';
import { camera, controls } from './scene.js';
import { buildingMeshes, buildingByName, setFocusedBuilding } from './buildings.js';
import { readmeExcerpt, readmeKnown } from './readme.js';
import { langHex } from './constants.js';
import { fmtNum, handheld } from './util.js';

export const tour = { active: false, paused: false, t: 0, legs: null, leg: 0, card: null, stops: null, stop: 0 }; // showcase flight (see updateTour)
// What the tour needs from app.js, handed over once (initTour): the city.json
// featured list and the profile's pinned repos (tour order), the repo panel, the
// building.json prefetch, the explorer (it may own the camera) and the idle-orbit setting.
let deps = { featured: () => [], pinned: () => [], openPanel() {}, prefetch() {}, inspect: () => false, closeInspect() {},
  transitInspect: () => false, guideOpen: () => false, stopGource() {}, explorer: () => null, flyover: () => true };
export function initTour(d) { deps = { ...deps, ...d }; }

// Showcase flight — the default way into a city. The camera flies from
// building to building (most-starred first), circles each one while a name
// card shows, and every few stops swoops out over the island. It loops until
// you take the controls (drag, scroll, click), and T / Tour toggles it.

const _tp = new THREE.Vector3(), _tl = new THREE.Vector3();
const smootherstep = (u) => u * u * u * (u * (u * 6 - 15) + 10);
// Which way the rooftop board faces. repo-signs.js puts it on the roof edge
// pointing away from the plaza, snapped to the nearest cardinal face normal —
// so a camera on this bearing reads the sign square on, and the tour lands
// there. Matching the snap matters: the raw outward bearing is up to 45° off
// the board, which is what left stops looking at it edge-on.
function signBearing(b, fallback) {
  const top = b.bodies?.[b.bodies.length - 1] || b.body;
  const gx = b.mesh.position.x + (top?.position.x || 0);
  const gz = b.mesh.position.z + (top?.position.z || 0);
  if (Math.hypot(gx, gz) <= 1) return fallback; // dead centre: no outward face to prefer
  return Math.abs(gx) > Math.abs(gz) ? (gx > 0 ? 0 : Math.PI) : (gz >= 0 ? Math.PI / 2 : -Math.PI / 2);
}
// A leg is { dur, pos(u, out), look(u, out), repo? } with u running 0..1.
// How far up the frame the subject has to move, as a fraction of the viewport.
//
// A building is framed in the middle of the canvas, which is right until
// something is covering the middle of the canvas. On a phone the guide is a
// sheet across the bottom half, so the thing being described sits behind the
// description of it. This measures what is still clear and reports how far the
// composition has to shift for the subject to sit in the middle of *that*.
//
// Zero on a wide screen: the guide is a column down one side there, and a
// column does not hide the subject, so desktop framing is untouched.
function framingBias() {
  const sheet = document.querySelector('.gri-dialog[open]:not([hidden])');
  if (!sheet) return 0;
  const vh = window.innerHeight || 1, vw = window.innerWidth || 1;
  const r = sheet.getBoundingClientRect();
  if (r.width < vw * 0.72) return 0;          // a side column, not a sheet
  const covered = Math.max(0, vh - r.top) / vh;
  if (covered < 0.25) return 0;
  const clearCentre = (1 - covered) / 2;      // middle of the strip still showing
  return Math.min(0.42, 0.5 - clearCentre);   // how far up, capped so it never overshoots
}

// The vertical world distance that one screen-height spans at distance d, for
// the scene camera's 50 degree field of view: 2 * tan(25 deg) = 0.933.
const SCREEN_SPAN = 0.933;

function orbitLeg(b, fallbackBearing, { dur = 6.5, sweep = 0.9, loop = false, from = null } = {}) {
  const cx = b.mesh.position.x, cz = b.mesh.position.z, h = b.h || 8;
  const r = Math.max(20, h * 0.8 + 16);
  // Stay above the neighbouring rooftops so a dense city never clips the camera.
  let roof = 0;
  for (const o of buildingMeshes) if (o !== b && Math.hypot(o.mesh.position.x - cx, o.mesh.position.z - cz) < r + 8) roof = Math.max(roof, o.h || 0);
  const y = Math.max(10, h * 0.6 + 6, roof + 6);
  // Start square in front of the rooftop board and drift from there, so the
  // stop always opens on a readable sign instead of a corner of the building.
  const a0 = from == null ? signBearing(b, fallbackBearing) : from;
  return {
    dur, loop, repo: b.repo, b,
    // The radius grows with the bias: a building pushed into the top third of
    // the screen needs more room around it, or the sheet clips its feet.
    pos: (u, o) => {
      const d = r * (1 + framingBias() * 0.55);
      return o.set(cx + Math.cos(a0 + sweep * u) * d, y + (loop ? 0 : Math.sin(u * Math.PI) * 2), cz + Math.sin(a0 + sweep * u) * d);
    },
    // Aiming below the building tips the camera down, which carries the
    // building up the frame and into the strip the sheet has left clear.
    look: (u, o) => {
      const bias = framingBias();
      const d = r * (1 + bias * 0.55);
      return o.set(cx, h * 0.55 - bias * d * SCREEN_SPAN, cz);
    },
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
  if (!tour.stops) {
    let picks = tourStops();
    // Embed mode visits the top few and then moves on, rather than working
    // through forty repositories before anyone sees a second island.
    const cap = Number(document.documentElement.dataset.stops || 0);
    if (cap > 0) picks = picks.slice(0, cap);
    tour.stops = picks.map(p => p.b); tour.highlights = picks.map(p => p.highlight);
  }
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
  while (leg && tour.t >= leg.dur) {
    tour.t -= leg.dur;
    // A stop being read about circles for as long as the guide is on air: its
    // leg is a whole turn, so wrapping back to u=0 is the same camera.
    if (leg.hold && deps.guideOpen()) break;
    leg = tour.legs[++tour.leg];
  }
  if (!leg) {
    tour.legs = null; tour.t = 0; // the next frame plans a new round from here
    // ...unless this is an embed, where a finished round is the cue to leave:
    // a screen saver that tours one developer forever is a screen saver of one
    // developer. ?islands=0 keeps it home and lets the round repeat.
    if (document.documentElement.dataset.embed && document.documentElement.dataset.islands !== '0') deps.nextIsland?.();
    return;
  }
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
  // Bring the full field guide on-air as the approach finishes, once the
  // building is framed. The following orbit leg shares the same visit and
  // must not open it a second time after the visitor continues the tour.
  // A guide already on air (a hop between stops) re-tunes as soon as the new
  // leg starts, so the reader is never left staring at the last repo.
  const atBuilding = leg.repo && (!leg.next || u >= (warping ? 0.12 : 0.78));
  if (atBuilding && !leg.autoInspected) {
    // A phone only opens the guide when it is asked to (see handheld): the
    // card narrates the stop and the tour rolls on. Once the guide *is* open
    // -- the card's button, or a hop with it already on air -- every stop
    // retunes it, or the reader is left on the last repo while the camera
    // flies to the next one.
    if (handheld() && !deps.guideOpen()) leg.autoInspected = true;
    else if (openTourReadme(leg.repo)) { leg.autoInspected = true; warping = false; holdCurrentStop(); }
  }
}
// Settle the stop the camera is on into a slow turn around its building, held
// for as long as the guide stays open. The approach carries on to the building
// first; the shot it lands in becomes the turn.
function holdCurrentStop() {
  const leg = tour.legs?.[tour.leg];
  if (!leg || leg.hold) return;
  const orbit = leg.next ? tour.legs[tour.leg + 1] : null;
  if (orbit?.repo === leg.repo) tour.legs[tour.leg + 1] = holdLeg(orbit, null);
  else if (leg.b) {
    tour.legs[tour.leg] = holdLeg(leg, Math.atan2(camera.position.z - leg.b.mesh.position.z, camera.position.x - leg.b.mesh.position.x));
    tour.t = 0; // picked up from the camera's own bearing, so nothing jumps
  }
}
// The circling shot a stop holds while its field guide is open: a whole turn at
// a steady height, so the camera never stops and never jumps when it comes round.
function holdLeg(leg, from) {
  return Object.assign(orbitLeg(leg.b, 0, { dur: 64, sweep: Math.PI * 2, loop: true, from }),
    { stop: leg.stop, of: leg.of, highlight: leg.highlight, autoInspected: true, planned: true, hold: true });
}
// How long an embedded stop lingers before the tour moves on. Long enough to
// read a good part of the README and watch the commit replay get going; short
// enough that a screen saver is never a still picture.
const EMBED_DWELL_MS = 21000;
let embedDwell = 0;
// Closing the guide lets the held stop go: the tour moves on from the next frame.
function releaseHold() {
  const leg = tour.legs?.[tour.leg];
  if (leg?.hold) { leg.hold = false; tour.t = leg.dur; }
}
// Jump the showcase to the next (+1) / previous (-1) repo, or back to the
// current one (0, after the user looked around): fly there from wherever the camera is.
let warping = false; // the field guide is on air, waiting for the next stop to arrive
export function tourJump(dir) {
  if (!tour.active) return;
  if (!tour.stops) buildShowcase(); // fixes the stop list
  const n = tour.stops?.length || 0;
  if (!n) return;
  const next = ((tour.stop || 0) + dir + n) % n;
  // Keep an open field guide on air and warp it across to the next repo (the
  // way an island hop does) rather than tearing it down and building it again.
  deps.stopGource(); // the last stop's replay ends with its stop
  warping = deps.transitInspect(tour.stops[next]?.repo);
  if (!warping) deps.closeInspect();
  tour.legs = buildShowcase(next);
  tour.leg = 0; tour.t = 0; tour.paused = false;
  controls.autoRotate = false;
}
function openTourReadme(repo) {
  if (!repo) return false;
  // The tour never stops for the guide: the camera keeps circling the building
  // being read about until the guide is closed or the visitor moves on.
  const opened = deps.inspect(repo, {
    status: 'TOUR · CIRCLING',
    resumeLabel: 'Continue tour ',
    note: 'The camera keeps circling while you read.',
    modal: false,
    // "Continue tour" picks the showcase back up where it paused. Escape is the
    // visitor backing out of the whole thing, and used to do neither: the guide
    // closed and the tour carried on circling a rooftop, because app.js's Esc
    // handler (which would have ended it) never runs while the guide claims the
    // key. Escape now leaves the tour and flies back out to the city.
    onClose: (why) => (why === 'escape' ? exitTourToCity() : releaseHold()),
  });
  // Embed mode (?embed=1) has no hands. The stop is held open until the guide
  // is closed, and nobody is going to close it -- so it closes itself, which
  // releases the hold and moves the tour along exactly as a visitor would.
  if (opened && document.documentElement.dataset.embed) {
    clearTimeout(embedDwell);
    embedDwell = setTimeout(() => deps.closeInspect(), EMBED_DWELL_MS);
  }
  return opened;
}
// A small TV set for the showcase: which repo the camera is heading to or
// circling, what it is, and how popular. It flickers like a CRT on each change.
// The same set stands in for the guide on a phone, where a tapped building
// would otherwise be buried under a sheet -- see showRepoCard.
let cardOpen = null; // what the set's "Open full README" does for whatever it is showing
function tourRead() { if (openTourReadme(tour.cardRepo)) holdCurrentStop(); }
function cardElement() {
  let el = document.getElementById('showcase-card');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'showcase-card';
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="sc-screen"><div class="sc-kicker"></div><div class="sc-name"></div>
      <div class="sc-desc"></div><div class="sc-meta"></div>
      <section class="sc-readme-panel" aria-label="README preview">
        <div class="sc-readme-signal"><span>From the readme</span><i></i><b>live</b></div>
        <div class="sc-pic"><img alt="" referrerpolicy="no-referrer" decoding="async"></div>
        <div class="sc-readme"></div>
      </section></div>
    <div class="sc-chin"><span class="sc-led"></span>
      <button class="sc-ch" type="button" data-dir="-1" aria-label="Previous repo">\u2039</button><span class="sc-stop"></span>
      <button class="sc-ch" type="button" data-dir="1" aria-label="Next repo">\u203a</button>
      <button class="sc-read" type="button">Open full README</button>
      <span class="sc-hint">\u2190 \u2192 switch \u00b7 click a building to watch</span></div>`;
  el.querySelectorAll('.sc-ch').forEach(b => b.addEventListener('click', () => tourJump(Number(b.dataset.dir))));
  // Asked for by hand: on a phone this is the only thing that opens the guide.
  el.querySelector('.sc-read').addEventListener('click', () => cardOpen?.());
  document.body.appendChild(el);
  return el;
}
// Put one repo on the set, or null to take it off air. `view` carries what
// differs between a tour stop and a repo standing on its own: the kicker, the
// stop counter, and whether there are other stops to step through.
function renderCard(view) {
  const el = cardElement();
  const repo = view?.repo || null, key = view?.key || null;
  if (tour.card === key) return;
  const sameRepo = repo && tour.card && tour.card.split('|')[0] === (repo.full_name || repo.name);
  const wasLanded = el.classList.contains('landed');
  tour.card = key;
  tour.cardRepo = repo;
  if (!repo) { el.classList.remove('show', 'landed', 'readme-in', 'readme-ready'); return; }
  const landed = !!view.landed;
  el.classList.toggle('landed', landed);
  el.classList.toggle('no-nav', !view.nav); // one repo on its own: nothing to step through
  el.querySelector('.sc-kicker').textContent = view.kicker;
  el.querySelector('.sc-name').textContent = repo.name;
  el.querySelector('.sc-read').setAttribute('aria-label', `Read ${repo.name} README`);
  el.querySelector('.sc-desc').textContent = repo.description || 'No description yet.';
  const days = repo.pushed_at ? Math.max(0, Math.round((Date.now() - Date.parse(repo.pushed_at)) / 86400000)) : null;
  const meta = [`\u2605 ${fmtNum(repo.stargazers_count || 0)}`, `\u2442 ${fmtNum(repo.forks_count || 0)}`, repo.language,
    days == null ? '' : days === 0 ? 'updated today' : `updated ${days}d ago`].filter(Boolean);
  el.querySelector('.sc-meta').replaceChildren(...meta.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  el.querySelector('.sc-stop').textContent = view.stopText || '';
  el.style.setProperty('--sc-lang', langHex(repo.language));
  // A few lines from the README (plain text only), and the next stop's fetched ahead.
  const readme = el.querySelector('.sc-readme'), pic = el.querySelector('.sc-pic img');
  const stillHere = () => tour.card && tour.card.startsWith(`${repo.full_name || repo.name}|`);
  if (!sameRepo) {
    readme.textContent = 'Receiving README\u2026';
    el.classList.remove('has-pic', 'pic-loading', 'pic-in', 'readme-ready');
    pic.removeAttribute('src');
  }
  readmeExcerpt(repo).then(({ text, image }) => {
    if (!stillHere()) return;
    readme.textContent = text || 'No README signal found for this repository.';
    if (el.classList.contains('landed')) {
      el.classList.remove('readme-ready'); void readme.offsetWidth; el.classList.add('readme-ready');
    }
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
  const ahead = view.ahead;
  if (ahead) readmeExcerpt(ahead.repo);
  // Repo-level .git-city/building.json: load it for this stop and the next, so
  // graffiti, roofs and neon are up before the camera arrives.
  deps.prefetch(repo); if (ahead) deps.prefetch(ahead);
  el.classList.add('show');
  if (landed && !wasLanded) {
    el.classList.remove('readme-in'); void el.offsetWidth; el.classList.add('readme-in');
  } else if (!landed) el.classList.remove('readme-in');
  if (!sameRepo) { el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); } // CRT channel change
}
function showcaseCard(leg) {
  const repo = leg?.repo || null;
  if (!repo) return renderCard(null);
  cardOpen = tourRead;
  renderCard({
    repo,
    key: `${repo.full_name || repo.name}|${leg.next ? 'next' : 'here'}`,
    kicker: (leg.next ? 'Next stop' : 'Now circling') + (leg.highlight ? ` \u00b7 ${leg.highlight}` : ''),
    landed: !leg.next,
    stopText: leg.stop ? `${leg.stop} / ${leg.of}` : '',
    nav: true,
    ahead: tour.stops?.[leg.stop % (tour.stops?.length || 1)] || null,
  });
}
// The same set, for a building the visitor tapped rather than a tour stop: the
// repo, a few lines of its README, and the way in -- instead of the guide
// opening over the city it was tapped in. `onRead` is what its button does.
export function showRepoCard(repo, onRead) {
  if (tour.active) return false; // the tour is narrating; do not talk over it
  cardOpen = onRead || null;
  renderCard(repo ? {
    repo, key: `${repo.full_name || repo.name}|one`, kicker: 'Now circling',
    landed: true, stopText: '', nav: false, ahead: null,
  } : null);
  return !!repo;
}
// Take a standalone card off air (a tap on open ground, or the guide taking over).
export function hideRepoCard() { if (!tour.active) showRepoCard(null); }

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
  warping = false;
  if (tourResumeTimer) { clearTimeout(tourResumeTimer); tourResumeTimer = 0; } // nothing to fly back to
  clearTimeout(embedDwell); embedDwell = 0; // a stop that is gone must not release a later one
  deps.stopGource();
  deps.closeInspect(); // the field guide belongs to the tour: it leaves with it
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
  // The tour fades the city back behind whichever stop is in focus, and a
  // click is the same act of attention -- it just arrived by a different
  // route. cine.focus rather than leg.b so the fade is already on during the
  // approach, instead of snapping in when the orbit leg takes over; the flight
  // home carries no focus, so the city comes back up by itself.
  setFocusedBuilding(cine.focus || leg.b || null);
}
export function flyToBuilding(b) {
  if (deps.explorer()?.ownsCamera) return; // walk / drive / fly own the camera
  // Where closing the guide should put us back. Clicking a building from a tour
  // used to record the tour's close-up as "where you were orbiting", so Escape
  // flew you from one rooftop to another and never came back out. A tour stop is
  // not an orbit to return to: from a tour, the way back is the whole city.
  const fromTour = tour.active; // endTour is about to clear it
  endTour();
  if (!orbitReturn) orbitReturn = fromTour
    ? { ...cityFraming(), autoRotate: deps.flyover() }
    : { target: controls.target.clone(), position: camera.position.clone(), autoRotate: controls.autoRotate };
  controls.autoRotate = false;
  // Arc up over the rooftops into a framing orbit, then circle slowly while its panel is open.
  const circle = orbitLeg(b, Math.atan2(camera.position.z, camera.position.x), { dur: 40, sweep: Math.PI * 2, loop: true });
  cine = { legs: [flyLeg(camera.position, controls.target, circle.pos(0, new THREE.Vector3()), circle.look(0, new THREE.Vector3()), 2.6), circle], leg: 0, t: 0, focus: b };
}
// The framing the city opens on, and the one every way out leads back to:
// Reset view, Escape from a tour, and closing a building clicked during one.
// Exported so those cannot drift apart into three slightly different cities.
export function cityFraming() {
  const extent = Math.max(24, ...buildingMeshes.map(b => Math.max(Math.abs(b.mesh.position.x), Math.abs(b.mesh.position.z)) + 6));
  const distance = Math.min(350, Math.max(120, extent * 3.0) / Math.min(1, camera.aspect));
  const target = new THREE.Vector3(0, 10, 0);
  return { target, position: target.clone().add(new THREE.Vector3(1, 0.85, 1).normalize().multiplyScalar(distance)) };
}
// Back out to the whole city: end the tour and fly -- not snap, the way the
// Reset view button does -- to the framing the city opens on.
export function exitTourToCity(dur = 2.2) {
  endTour();
  const { target, position: pos } = cityFraming();
  orbitReturn = null;
  controls.autoRotate = false; // the flight owns the camera until it lands
  cine = { legs: [flyLeg(camera.position, controls.target, pos, target, dur)], leg: 0, t: 0,
    onDone: () => { controls.autoRotate = deps.flyover(); } };
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
