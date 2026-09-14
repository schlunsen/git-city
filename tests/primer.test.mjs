import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (f) => readFile(new URL(`../public/${f}`, import.meta.url), 'utf8');

// --- a small slice of the cascade -------------------------------------------
// The welcome card shipped broken twice over one mistake, in two places: an id
// rule sets `display` on it, and an id rule quietly outranks both the browser's
// own `[hidden] { display: none }` and any class rule trying to switch a part
// off. So `el.hidden = true` did nothing, "Start exploring" looked dead, and
// the card faded out and then snapped straight back when the fade class came
// off. Asserting the text of a selector would not have caught it -- what has to
// hold is which rule wins -- so this works out the winner the way a browser does.

/** Every `selector { ... display: X ... }` in the sheet, in source order, with its @media. */
function displayRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0, media = null, mediaDepth = -1, depth = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim().split(/[};]/).pop().trim();
    if (head.startsWith('@')) { // an at-rule: remember the condition, walk inside it
      if (/^@media/.test(head)) { media = head.slice(6).trim(); mediaDepth = depth; }
      depth++; i = open + 1; continue;
    }
    let close = open + 1, d = 1;
    while (close < css.length && d) { if (css[close] === '{') d++; else if (css[close] === '}') d--; close++; }
    const body = css.slice(open + 1, close - 1);
    const m = body.match(/(?:^|;)\s*display\s*:\s*([^;!]+)/);
    for (const sel of head.split(',')) if (m) out.push({ sel: sel.trim(), display: m[1].trim(), media, order: out.length });
    i = close;
    while (depth > 0 && css.slice(i).match(/^\s*\}/)) { // left the at-rule block
      i = css.indexOf('}', i) + 1; depth--; if (depth === mediaDepth) { media = null; mediaDepth = -1; }
    }
  }
  return out;
}

/** CSS specificity as the one number a comparison needs. */
const spec = (sel) => {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const types = (sel.replace(/[#.][\w-]+|\[[^\]]+\]|::?[\w-]+/g, '').match(/[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + classes * 100 + types;
};

/** What `display` an element actually gets, given the rules whose selectors match it. */
const winner = (rules, matches) => rules.filter(matches)
  .sort((a, b) => spec(a.sel) - spec(b.sel) || a.order - b.order).pop();

const css = await read('styles.css');
const rules = displayRules(css);
const primerRules = rules.filter(r => r.sel.includes('primer'));
const noMedia = (r) => !r.media || !/pointer\s*:\s*coarse/.test(r.media);

test('the browser stylesheet parse found the primer rules at all', () => {
  assert.ok(primerRules.length >= 4, `expected the primer display rules, found ${primerRules.length}`);
  assert.ok(primerRules.some(r => r.sel === '#primer'), 'the card itself sets a display');
});

test('hidden actually hides the card, so dismissing it sticks', () => {
  // The card, wearing the hidden attribute, on a desktop.
  const won = winner(primerRules, r => noMedia(r) &&
    (r.sel === '#primer' || r.sel === '#primer[hidden]'));
  assert.equal(won.display, 'none',
    `#primer[hidden] must beat #primer, otherwise el.hidden = true is a no-op and the ` +
    `card never leaves. Winning rule was "${won.sel} { display: ${won.display} }".`);
});

test('a desktop gets the keyboard list and a phone gets the touch list', () => {
  const listRules = (cls) => primerRules.filter(r =>
    r.sel === '#primer ul' || r.sel.endsWith(cls));
  const fine = (cls) => winner(listRules(cls), noMedia);
  const coarse = (cls) => winner(listRules(cls), () => true); // coarse rules come later and match too

  assert.notEqual(fine('.primer-keys').display, 'none', 'a desktop shows the keys');
  assert.equal(fine('.primer-taps').display, 'none',
    `the touch list must be off by default -- "#primer ul { display: grid }" outranks a bare ` +
    `".primer-taps { display: none }", which stapled the phone list under the keys on every desktop. ` +
    `Winner: "${fine('.primer-taps').sel}".`);
  assert.equal(coarse('.primer-keys').display, 'none', 'a phone hides the keys');
  assert.notEqual(coarse('.primer-taps').display, 'none', 'a phone shows the taps');
});

// --- the card must not lie about the controls --------------------------------
test('every key the welcome card teaches is a key the app really binds', async () => {
  const [html, explore, app] = await Promise.all([read('index.html'), read('explore.js'), read('app.js')]);
  const card = html.slice(html.indexOf('<div id="primer"'), html.indexOf('</div>', html.indexOf('primer-go')));
  const taught = [...card.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map(m => m[1]);
  assert.deepEqual([...new Set(taught)].sort(),
    ['1', '2', '3', '4', 'A', 'D', 'E', 'Esc', 'N', 'S', 'Space', 'T', 'W'].sort(),
    'the card teaches this set of keys; update the bindings check below if it changes');

  assert.match(explore, /\/\^Digit\[1-4\]\$\//, '1-4 pick a mode');
  assert.match(explore, /'walk', 'drive', 'fly'/, '...and those modes are walk, drive and fly');
  assert.match(explore, /e\.code === 'KeyN'/, 'N sails to the next island');
  assert.match(app, /e\.key === 't' \|\| e\.key === 'T'/, 'T runs the tour');
  const walkHint = explore.match(/walk: \(\) => \([\s\S]*?\),\n/)[0];
  for (const key of ['W/S', 'A/D', 'Space', 'E']) {
    assert.ok(walkHint.includes(key), `walk mode really binds ${key} (the HUD hint says so)`);
  }
});

test('an embed gets no welcome card and no held load screen', async () => {
  const app = await read('app.js');
  const boot = app.slice(app.indexOf('const askedPrimer'), app.indexOf('loadCity(startUser)'));
  assert.match(boot, /!EMBED/, 'an embed is a picture on someone else\'s page: never interrupt it');
  assert.match(boot, /askedPrimer !== '0'/, '?primer=0 suppresses it');
  assert.match(boot, /askedPrimer !== null \|\| !readPref\(PRIMER_SEEN\)/, '?primer=1 forces it; otherwise once per visitor');
});

// --- recording -----------------------------------------------------------
test('a recording request is clamped to something a browser can survive', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const fn = app.slice(app.indexOf('function recordingRequest()'), app.indexOf('function armRecording'));
  assert.match(fn, /Math\.min\(Math\.max\(Number\(PARAMS\.get\('record'\)\) \|\| 15, 1\), 120\)/,
    'a tab asked to record for an hour is a mistake, not a request');
  assert.match(fn, /\^\(\\d\{2,5\}\)x\(\\d\{2,5\}\)\$/, '?size= is parsed, not trusted');
  assert.match(app, /if \(!EMBED && !recording &&/, 'the welcome card must never interrupt a recording');
});
