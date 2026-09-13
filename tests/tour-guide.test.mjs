import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../public/${p}`, import.meta.url), 'utf8');

// The guide opens by itself on a roomy screen, where it sits beside the city,
// and never on a phone, where it is a sheet across most of it. Two rules decide
// that: the width handheld() tests, and the width the stylesheet turns the
// guide into a sheet at. If they drift apart the guide starts covering a city
// nobody asked it to cover -- silently, because nothing else notices.
test('the guide opens itself only where it does not cover the city', async () => {
  const util = await read('city/util.js');
  const breakpoints = [...util.matchAll(/export const handheld = \(\) => matchMedia\('\(max-width:(\d+)px\)'\)/g)];
  assert.equal(breakpoints.length, 1, 'handheld() is defined once, in city/util.js');
  const px = breakpoints[0][1];

  const inspector = await read('repo-inspector.js');
  assert.match(inspector, new RegExp(`@media\\(max-width:${px}px\\)\\{[^\\n]*\\.gri-dialog\\{height:calc\\(100dvh`),
    `the guide becomes a full sheet at ${px}px, so handheld() must test that same width`);

  // Every consumer shares the one definition rather than keeping its own copy.
  for (const file of ['app.js', 'repo-inspector.js', 'city/tour.js']) {
    const src = await read(file);
    assert.match(src, /import \{[^}]*\bhandheld\b[^}]*\} from '\.{1,2}\/?(city\/)?util\.js'/,
      `${file} imports handheld rather than re-deriving it`);
    assert.doesNotMatch(src, /(const|let)\s+\w+\s*=\s*\(\)\s*=>\s*matchMedia\('\(max-width/,
      `${file} must not keep a second opinion about what a phone is`);
  }
});

// A drag pauses the showcase and flies back to the stop; a tap on open ground
// is someone stepping out of it, and must end it rather than pause it.
test('a tap on open ground ends the showcase instead of pausing it', async () => {
  const app = await read('app.js');
  const ground = app.match(/if \(hits\.length > 0\) visitRepo\([\s\S]*?\n  \}/);
  assert.ok(ground, 'the pointer-up branch for a miss is where this is decided');
  assert.match(ground[0], /if \(tour\.active\) endTour\(\);/, 'a miss ends a running tour');

  // ...and ending it must call off the pause-resume hop, or the tour flies
  // back to its stop a couple of seconds after the visitor left it.
  const tour = await read('city/tour.js');
  const endTour = tour.match(/export function endTour\(\) \{[\s\S]*?\n\}/);
  assert.ok(endTour, 'endTour is where a tour is torn down');
  assert.match(endTour[0], /clearTimeout\(tourResumeTimer\)/, 'endTour cancels a pending resume');
});

// On a phone the tour narrates with its card and the card is the way in, so
// the stop it opens has to be held the same way an automatic open holds it --
// otherwise the camera flies on and leaves the reader on the wrong repo.
test('opening the readme by hand holds the stop it was opened from', async () => {
  const tour = await read('city/tour.js');
  assert.match(tour, /function tourRead\(\) \{ if \(openTourReadme\(tour\.cardRepo\)\) holdCurrentStop\(\); \}/,
    "the tour's way in holds the stop it opens");
  assert.match(tour, /\.sc-read'\)\.addEventListener\('click', \(\) => cardOpen\?\.\(\)\)/,
    'the card button runs whatever the card is currently offering');
  assert.match(tour, /if \(handheld\(\) && !deps\.guideOpen\(\)\) leg\.autoInspected = true;/,
    'a phone skips the automatic open, but only while the guide is closed');
  // The second half of that rule matters: once the guide is open, every stop
  // must retune it, or a hop leaves the reader looking at the previous repo.
  assert.match(tour, /else if \(openTourReadme\(leg\.repo\)\) \{ leg\.autoInspected = true; warping = false; holdCurrentStop\(\); \}/,
    'an open guide keeps being retuned as the tour moves');
});

// The card narrates a tour stop and, on a phone, a tapped building too. Both
// need the same face: a README teaser and a way in. The teaser used to be
// dropped on small screens because the guide opened itself there and already
// had the README -- it does not any more, so dropping it would leave the card
// with nothing to say and no reason to tap it.
test('the phone card keeps its readme teaser', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 700px), (max-height: 560px) {'));
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  assert.doesNotMatch(block, /#showcase-card \.sc-readme-panel \{ display: none/,
    'the teaser stays on a phone now that the guide no longer opens itself there');
  assert.match(block, /#showcase-card \{ width: calc\(100vw - 16px\); \}/, 'the phone card runs full width');
});

// The card reads the page's ink tokens, which invert with the theme, but its
// screen was a CRT with its colours baked in -- so by day it put dark ink on a
// black screen. Every surface it paints itself has to turn with the page.
test('the card turns to paper with the rest of the page', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const surface of ['#showcase-card', '#showcase-card .sc-screen']) {
    assert.ok(css.includes(`:root[data-theme="paper"] ${surface} {`),
      `${surface} needs a daylight face, or its ink lands on a dark screen`);
  }
  const paper = css.slice(css.indexOf(':root[data-theme="paper"] #showcase-card {'));
  assert.doesNotMatch(paper.slice(0, paper.indexOf('\n}')), /#0[0-9a-f]{5}|#1[0-9a-f]{5}/,
    'the daylight card must not repaint itself with the night palette');
});

// Two of these changes hide something until code puts it back, which means a
// missed path does not degrade -- it strands the interface. The card would
// stay invisible for the rest of the session, and the city would stay frozen
// behind a sheet. Both releases are pinned here.
test('everything taken down for a load is put back on every path', async () => {
  const app = await read('app.js');
  const load = app.slice(app.indexOf('async function loadCity('));
  const body = load.slice(0, load.indexOf('\n}\n'));
  assert.match(body, /hideProfileCard\(\);/, 'a load takes the previous island\'s card down');
  // ...so every way out of that load has to bring one back.
  assert.match(body, /settleProfileCard\(\);\s*\/\/ the island arrives first/, 'the built city settles its card in');
  const caught = body.slice(body.indexOf('} catch (e) {'));
  assert.match(caught, /settleProfileCard\(\);/,
    'a failed load leaves the old city standing, so its card must come back');
});

test('the replay never leaves the city frozen', async () => {
  const inspector = await read('repo-inspector.js');
  const stop = inspector.match(/function stopHistory\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(stop, /markReplaying\(false\)/, 'ending a replay lets the city render again');
  assert.match(stop, /removeEventListener\('message', historyListener\)/, 'and drops its listener');
  // close() and fill() both run stopHistory, so closing the guide or retuning
  // it to another repo releases the city too.
  for (const fn of ['function close(reason) {', 'function fill(r, options) {']) {
    const block = inspector.slice(inspector.indexOf(fn));
    assert.match(block.slice(0, block.indexOf('\n  }')), /stopHistory\(\)/, `${fn} must release the replay`);
  }
  const app = await read('app.js');
  assert.match(app, /dataset\.replay && handheld\(\)/,
    'the render gate re-checks the screen, so a stale flag cannot freeze a desktop city');
});
