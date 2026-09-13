import { GOURCE_VIEW } from './constants.js';
import { cine, tour, tourJump } from './tour.js';

// Gource View in a lightbox: the repo's whole commit history replayed as a
// growing tree, without leaving the city. The iframe only exists while the
// player is open, so nothing plays or downloads in the background.
// video=1 opens Gource View's clean "▶ Video" composition as soon as the
// history has loaded, instead of the full app UI; embed=1 hides its scrubber
// and has it tell this page when the video opens / closes (postMessage).
// chrome=0 asks Gource View for the picture alone: no control bar, no keyboard
// shortcuts and no focus grab inside the frame — the tour's mini screen supplies
// its own controls, and the city keeps its own keys.
export function gourceUrl(repo, { video = true, chrome = true } = {}) {
  // music=none: the embedded player plays without music.
  return `${GOURCE_VIEW}?repo=${encodeURIComponent(repo.full_name)}&max=3000${video ? '&video=1&embed=1&music=none' : ''}${chrome ? '' : '&chrome=0'}`;
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
export let gourceCovering = false;
export function openGource(repo, from = null) {
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
export function closeGource(animated = false) {
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
// ---------------------------------------------------------------------------
// The tour's mini screen: the same replay, docked where the showcase card sits.
// It loads out of sight behind the card and only takes the corner once Gource
// View says its first frame is up — so the stop is never a blank black box.
// Desktop only: on a phone the card and the touch controls need that corner.
// ---------------------------------------------------------------------------
const MINI_OK = '(min-width: 1100px) and (min-height: 640px) and (hover: hover)';
let miniRepo = '', miniOn = null;
export function tuneGource(repo) {
  if (!repo?.full_name || !matchMedia(MINI_OK).matches) { stopGource(); return; }
  if (miniRepo === repo.full_name) return;
  stopGource();
  miniRepo = repo.full_name; miniOn = repo;
  const box = miniBox();
  box.querySelector('.gn-title').textContent = `${repo.name} · commit history`;
  box.querySelector('.gn-ext').href = gourceUrl(repo);
  const frame = document.createElement('iframe');
  frame.src = gourceUrl(repo, { chrome: false });
  frame.title = `Gource View: ${repo.full_name}`;
  frame.allow = 'autoplay';
  box.querySelector('.gn-frame').replaceChildren(frame);
  box.hidden = false;
  box.classList.add('loading');
  box.classList.toggle('solo', !tour.active); // ‹ › only steer a running tour
}
export function stopGource() {
  miniRepo = ''; miniOn = null;
  const box = document.getElementById('gource-mini');
  if (!box) return;
  box.classList.remove('loading', 'ready', 'arriving', 'big', 'solo');
  document.body.classList.remove('gource-mini-on', 'gource-mini-big');
  box.querySelector('.gn-frame').replaceChildren(); // stops playback and downloads
  box.hidden = true;
}
function miniBox() {
  let box = document.getElementById('gource-mini');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'gource-mini';
  box.hidden = true;
  // The frame is cross-origin, so a click never reaches this page: an overlay
  // button on the glass is what makes the small screen open into the big one.
  box.innerHTML = `<div class="gn-screen"><div class="gn-frame"></div><div class="gn-crt"></div>
      <button class="gn-open" type="button" aria-label="Watch this history full size"></button></div>
    <div class="gn-head"><span class="gn-led"></span><span class="gn-title"></span>
      <button class="gn-ch" type="button" data-dir="-1" aria-label="Previous repo">‹</button>
      <button class="gn-ch" type="button" data-dir="1" aria-label="Next repo">›</button>
      <a class="gn-ext" target="_blank" rel="noopener">Open ↗</a>
      <button class="gn-close" type="button" aria-label="Back to the repo card">×</button></div>`;
  box.querySelectorAll('.gn-ch').forEach((b) => b.addEventListener('click', () => tourJump(Number(b.dataset.dir))));
  box.querySelector('.gn-close').addEventListener('click', stopGource);
  box.querySelector('.gn-open').addEventListener('click', () => expandGource());
  const scrim = document.createElement('div');
  scrim.id = 'gource-scrim';
  scrim.addEventListener('click', () => expandGource(false));
  document.body.append(scrim, box);
  return box;
}
// Clicking the glass grows the corner screen to the middle of the city and back.
// It is the same element and the same frame throughout, so the replay never
// stops, reloads, or loses its place — only its box moves and resizes.
export function expandGource(want) {
  const box = document.getElementById('gource-mini');
  if (!box || box.hidden) return;
  const big = want === undefined ? !box.classList.contains('big') : !!want;
  box.classList.remove('arriving');
  box.classList.toggle('big', big);
  document.body.classList.toggle('gource-mini-big', big);
  // The label lives on aria-label only. As a `title` the browser paints its own
  // tooltip over the replay a second after the pointer lands -- a grey box in
  // the middle of the picture, which is exactly what the corner chip exists to
  // avoid. Screen readers still get the wording.
  box.querySelector('.gn-open').setAttribute('aria-label', big ? 'Back to the corner' : 'Watch this history full size');
  document[big ? 'addEventListener' : 'removeEventListener']('keydown', miniKeys, true);
}
function miniKeys(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation(); // Esc leaves the big screen, not the city
  expandGource(false);
}
function revealMini() {
  const box = document.getElementById('gource-mini');
  if (!box?.classList.contains('loading')) return;
  box.classList.remove('loading');
  box.classList.add('ready', 'arriving');
  // The power-on animation is a one-shot: it has to let go of `transform` again,
  // or a filled animation would pin the panel and it could never grow.
  setTimeout(() => box.classList.remove('arriving'), 700);
  document.body.classList.add('gource-mini-on'); // the showcase card steps aside
  box.querySelector('iframe')?.contentWindow?.postMessage({ source: 'git-city', type: 'play' }, GOURCE_ORIGIN);
}

window.addEventListener('message', (e) => {
  if (e.origin !== GOURCE_ORIGIN || e.data?.source !== 'gource-view') return;
  // The mini screen and the full player each answer only for their own frame.
  const mini = document.querySelector('#gource-mini iframe');
  if (mini && e.source === mini.contentWindow) {
    if (e.data.type === 'video-ready') revealMini();
    else if (e.data.type === 'video-close' || e.data.type === 'error') stopGource();
    return;
  }
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
