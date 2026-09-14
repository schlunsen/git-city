import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeCityConfig, parseCityConfigText, fetchCityConfig, serializeCityConfig, isEmptyConfig, cleanText,
  newFileUrl, editFileUrl, configUrl, configRepo, OPTIONS, LIMITS, MAX_BYTES,
  normalizeBuildingConfig, mergeBuildingConfig, fetchBuildingConfig, serializeBuildingConfig, BUILDING_KEYS, BUILDING_MAX_BYTES,
} from '../public/city-config.js';
import { BIOMES, LANDMARK_SITES, SITE_KINDS, HORIZON_NAMES, BIOME_HORIZONS } from '../public/world.js';
import { THEME_NAMES, BIOME_THEMES, pickBuildingTheme } from '../public/city/themes.js';
import { ATTRACTIONS } from '../public/attractions.js';
import { CITY_SHAPE_NAMES } from '../public/city/layout.js';

const REPOS = ['git-city', 'gource-view', 'dotfiles', 'Hefty', 'constructor'].map((name) => ({ name }));
const norm = (raw, ctx = {}) => normalizeCityConfig(raw, { repos: REPOS, login: 'schlunsen', ...ctx });
const plain = (o) => JSON.parse(JSON.stringify(o));

const EXAMPLE = {
  version: 1,
  island: { name: 'Schlunsen Isle', biome: 'tropical', shape: 'round', streets: 5 },
  welcome: 'Welcome to the island of broken builds',
  look: { accent: '#8c78ff', time: 'sunset', weather: 'snow', tv: false, fx: true, timezone: 'Europe/Copenhagen' },
  landmarks: ['rollerCoaster', 'observatory', 'campsite'],
  neighbours: ['gaearon', 'antfu', 'sindresorhus'],
  featured: ['git-city', 'gource-view'],
  hide: ['dotfiles'],
  repos: {
    'git-city': { style: 'tower', color: '#64dedb', sign: 'you are here' },
    'gource-view': { billboard: 'Watch your repo grow' },
  },
  player: { music: 'cipher', volume: 20 },
  plane: { color: '#e4574f', name: 'Spirit of Rebase' },
};

test('valid config: every v1 field survives unchanged, no warnings', () => {
  const { config, warnings } = norm(EXAMPLE);
  assert.deepEqual(warnings, []);
  assert.deepEqual(plain(config), EXAMPLE);
  assert.equal(Object.getPrototypeOf(config.repos), null);
});

test('the input is never mutated', () => {
  const raw = structuredClone(EXAMPLE);
  raw.welcome = '  lots   of\n space ';
  const before = JSON.stringify(raw);
  norm(raw);
  assert.equal(JSON.stringify(raw), before);
});

test('unknown keys are dropped, with a hint for likely typos', () => {
  const { config, warnings } = norm({ version: 1, $schema: 'https://example.com/x.json', neighbors: ['antfu'], script: 'alert(1)', island: { name: 'X', onload: 'x' }, repos: { 'git-city': { color: '#000000', href: 'javascript:alert(1)' } } });
  assert.equal(config.script, undefined);
  assert.equal(config.neighbors, undefined);
  assert.equal(config.$schema, undefined, '$schema is an editor hint, never kept or loaded');
  assert.deepEqual(plain(config.island), { name: 'X' });
  assert.deepEqual(plain(config.repos), { 'git-city': { color: '#000000' } });
  assert.ok(warnings.some((w) => w.includes('"neighbors"') && w.includes('did you mean "neighbours"')));
  assert.ok(warnings.some((w) => w.includes('"script"')));
  assert.ok(warnings.some((w) => w.includes('island') && w.includes('"onload"')));
  assert.ok(!warnings.some((w) => w.includes('$schema')));
});

test('colours must be #rrggbb and come out lower-case', () => {
  for (const bad of ['#fff', 'red', '#12345g', '#1234567', 'rgb(0,0,0)', '8c78ff', 123, null, ['#ffffff'], ' #ffffff', 'url(https://x)']) {
    const { config, warnings } = norm({ look: { accent: bad }, plane: { color: bad } });
    assert.equal(config.look.accent, undefined, String(bad));
    assert.equal(config.plane.color, undefined, String(bad));
    assert.equal(warnings.length, 2, String(bad));
  }
  assert.equal(norm({ look: { accent: '#8C78FF' } }).config.look.accent, '#8c78ff');
});

test('named options come from the fixed lists', () => {
  const { config, warnings } = norm({ island: { biome: 'lava', shape: 'ROUND' }, look: { time: 'noon', weather: 'hail' }, player: { music: 'https://evil.example/x.mp3' }, repos: { 'git-city': { style: 'castle' } } });
  assert.deepEqual(plain(config.island), {});
  assert.deepEqual(plain(config.look), {});
  assert.deepEqual(plain(config.player), {});
  assert.deepEqual(plain(config.repos), {});
  assert.equal(warnings.length, 6);
  assert.equal(norm({ player: { music: 'none' } }).config.player.music, 'none');
  assert.deepEqual(plain(norm({ repos: { 'git-city': { style: 'auto' } } }).config.repos), {}, 'auto is the default, not stored');
});

test('text is trimmed, control / bidi characters stripped and capped by code points', () => {
  const { config, warnings } = norm({
    welcome: `  Hi\tthere\n\n${'\u202e'}evil${'\u0000'}\u0007 👩\u200d💻 `,
    island: { name: 'x'.repeat(200) },
    plane: { name: '🚀'.repeat(30) },
    repos: { 'git-city': { sign: '  ', billboard: 'b'.repeat(500) } },
  });
  assert.equal(config.welcome, 'Hi there evil 👩\u200d💻');
  assert.equal(config.island.name, 'x'.repeat(LIMITS.name));
  assert.equal(Array.from(config.plane.name).length, LIMITS.planeName);
  assert.equal(config.plane.name, '🚀'.repeat(LIMITS.planeName), 'surrogate pairs are never split');
  assert.equal(config.repos['git-city'].sign, undefined, 'blank text is no text');
  assert.equal(config.repos['git-city'].billboard.length, LIMITS.text);
  assert.ok(warnings.some((w) => w.startsWith('island.name: shortened')));
  assert.equal(cleanText('a\u2066b\u2069c\ufeffd\u200be', 50), 'abcde');
  assert.equal(cleanText('<img src=x onerror=alert(1)>', 120), '<img src=x onerror=alert(1)>', 'markup is kept as text: it only ever reaches textContent / fillText');
});

test('neighbours follow GitHub login rules, are de-duplicated and never include yourself', () => {
  const { config, warnings } = norm({ neighbours: ['-abc', 'abc-', 'a--b', 'x'.repeat(40), 'has space', '../etc', 'a_b', 'ok-name', 'OK-name', 'x'.repeat(39), 'Schlunsen', 42, null, 'gaearon'] });
  assert.deepEqual(config.neighbours, ['ok-name', 'x'.repeat(39), 'gaearon']);
  assert.ok(warnings.some((w) => w.includes('already here')));
  assert.ok(warnings.filter((w) => w.includes('not a GitHub login')).length >= 8);
});

test('oversized arrays and maps are capped', () => {
  const logins = Array.from({ length: 10 }, (_, i) => `user${i}`);
  const many = Array.from({ length: 150 }, (_, i) => ({ name: `r${i}` }));
  const { config, warnings } = normalizeCityConfig({
    neighbours: logins,
    landmarks: [...OPTIONS.landmark],
    featured: many.slice(0, 20).map((r) => r.name),
    hide: many.slice(40, 100).map((r) => r.name),
    repos: Object.fromEntries(many.map((r) => [r.name, { color: '#123456' }])),
  }, { repos: many });
  assert.equal(config.neighbours.length, LIMITS.neighbours);
  assert.equal(config.landmarks.length, LIMITS.landmarks);
  assert.equal(config.featured.length, LIMITS.featured);
  assert.equal(config.hide.length, LIMITS.hide);
  assert.equal(Object.keys(config.repos).length, LIMITS.repos);
  for (const k of ['neighbours', 'landmarks', 'featured', 'hide', 'repos']) assert.ok(warnings.some((w) => w.startsWith(k) && w.includes('only the first')), k);
});

test('repository names are matched against the profile, case-insensitively', () => {
  const { config, warnings } = norm({ featured: ['GIT-CITY', 'not-mine', 'hefty', 'dotfiles'], hide: ['dotfiles', 'nope', '../../x'], repos: { 'Gource-View': { sign: 'hi' }, ghost: { sign: 'boo' } } });
  assert.deepEqual(config.featured, ['git-city', 'Hefty']);
  assert.deepEqual(config.hide, ['dotfiles']);
  assert.deepEqual(plain(config.repos), { 'gource-view': { sign: 'hi' } });
  assert.ok(warnings.some((w) => w.includes('"not-mine"')));
  assert.ok(warnings.some((w) => w.includes('hide wins')));
  assert.ok(warnings.some((w) => w.includes('"../../x"') && w.includes('not a repository name')));
  // Without a repo list (e.g. before the profile loads) only the name syntax is checked.
  assert.deepEqual(normalizeCityConfig({ featured: ['anything', 'a b'] }).config.featured, ['anything']);
});

test('wrong types are dropped with a warning, never thrown', () => {
  const { config, warnings } = norm({
    version: '1', island: 'Tropical', welcome: 42, look: [], landmarks: 'rollerCoaster', neighbours: { a: 1 },
    featured: null, hide: 7, repos: ['git-city'], player: { music: 3, volume: '20' }, plane: true,
  });
  assert.ok(config);
  assert.ok(isEmptyConfig(config));
  assert.ok(warnings.length >= 11);
  assert.ok(warnings.some((w) => w.startsWith('version')));
});

test('look.tv / look.fx are strict booleans; false is kept (it is a choice)', () => {
  assert.deepEqual(plain(norm({ look: { tv: true, fx: false } }).config.look), { tv: true, fx: false });
  for (const bad of ['true', 1, 0, null, 'on', [], {}]) {
    const { config, warnings } = norm({ look: { tv: bad, fx: bad } });
    assert.deepEqual(plain(config.look), {}, JSON.stringify(bad));
    assert.equal(warnings.length, 2, JSON.stringify(bad));
    assert.ok(warnings[0].includes('true or false'));
  }
  const schema = JSON.parse(readFileSync(new URL('../public/schema/city-config.v1.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.look.properties.tv.type, 'boolean');
  assert.equal(schema.properties.look.properties.fx.type, 'boolean');
});

test('look.timezone: real IANA zones only, canonicalised, capped at 64', () => {
  const tz = (v) => norm({ look: { timezone: v } });
  assert.equal(tz('Europe/Copenhagen').config.look.timezone, 'Europe/Copenhagen');
  assert.equal(tz('Asia/Tokyo').config.look.timezone, 'Asia/Tokyo');
  assert.equal(tz('asia/tokyo').config.look.timezone, 'Asia/Tokyo', 'case is canonicalised');
  assert.equal(tz('UTC').config.look.timezone, 'UTC');
  for (const bad of ['Mars/Olympus_Mons', 'Europe/Copenhagen '.repeat(5), 'x'.repeat(65), '../etc/passwd', 'Europe/Copenhagen; rm -rf', '', 42, null, ['UTC']]) {
    const r = tz(bad);
    assert.equal(r.config.look.timezone, undefined, JSON.stringify(bad));
    assert.ok(r.warnings.some((w) => w.startsWith('look.timezone')), JSON.stringify(bad));
  }
  const schema = JSON.parse(readFileSync(new URL('../public/schema/city-config.v1.json', import.meta.url), 'utf8'));
  const s = schema.properties.look.properties.timezone;
  assert.equal(s.maxLength, 64);
  assert.ok(new RegExp(s.pattern).test('America/Argentina/Buenos_Aires') && !new RegExp(s.pattern).test('../x'));
});

test('numbers are clamped and rounded', () => {
  assert.equal(norm({ player: { volume: 150 } }).config.player.volume, 100);
  assert.equal(norm({ player: { volume: -5 } }).config.player.volume, 0);
  assert.equal(norm({ player: { volume: 20.6 } }).config.player.volume, 21);
  assert.equal(norm({ player: { volume: 1e308 } }).config.player.volume, 100);
});

test('prototype pollution: __proto__ / constructor keys never leak', () => {
  const raw = JSON.parse(`{
    "__proto__": { "polluted": 1, "welcome": "from proto" },
    "constructor": { "prototype": { "polluted": 1 } },
    "island": { "__proto__": { "name": "proto isle" }, "name": "Real" },
    "look": { "constructor": "#ffffff" },
    "repos": { "__proto__": { "color": "#ffffff" }, "constructor": { "color": "#000000" }, "prototype": { "sign": "x" } },
    "player": { "__proto__": { "volume": 1 } }
  }`);
  const { config } = norm(raw);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(config.polluted, undefined);
  assert.equal(config.welcome, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(config, '__proto__'));
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'constructor'));
  assert.equal(Object.getPrototypeOf(config), Object.prototype);
  assert.deepEqual(plain(config.island), { name: 'Real' });
  assert.equal(Object.getPrototypeOf(config.island), Object.prototype);
  assert.deepEqual(plain(config.look), {});
  assert.deepEqual(plain(config.player), {});
  // A real repo called "constructor" is fine: the map has no prototype to hit.
  assert.equal(Object.getPrototypeOf(config.repos), null);
  assert.deepEqual(Object.keys(config.repos), ['constructor']);
  assert.equal(config.repos.constructor.color, '#000000');
  assert.equal(config.repos.__proto__, undefined);
  // And with no repo list, the names still can't reach a prototype.
  const loose = normalizeCityConfig(raw).config;
  assert.equal(Object.getPrototypeOf(loose.repos), null);
  assert.equal(({}).color, undefined);
});

test('non-object roots mean no config', () => {
  for (const root of [null, undefined, [], [EXAMPLE], 'city', 42, true, 0]) {
    const { config, warnings } = normalizeCityConfig(root);
    assert.equal(config, null, JSON.stringify(root));
    assert.equal(warnings.length, 1);
  }
});

test('parseCityConfigText: size is checked before parsing, errors are strings', () => {
  assert.deepEqual(parseCityConfigText('{"version":1}'), { raw: { version: 1 }, error: null });
  assert.deepEqual(parseCityConfigText('\ufeff{"version":1}').raw, { version: 1 }, 'a BOM is tolerated');
  assert.match(parseCityConfigText('{"version":1,}').error, /not valid JSON/);
  assert.match(parseCityConfigText('').error, /not valid JSON/);
  assert.match(parseCityConfigText(' '.repeat(MAX_BYTES + 1)).error, /larger than 32 KB/);
  assert.match(parseCityConfigText(null).error, /could not be read/);
  // Deep nesting can't hurt the walker: it only reads fixed keys.
  const deep = `{"island":${'['.repeat(5000)}${']'.repeat(5000)}}`;
  const parsed = parseCityConfigText(deep);
  if (!parsed.error) assert.ok(normalizeCityConfig(parsed.raw).config);
});

const response = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });
test('fetchCityConfig: 404 is "no config", JSON is parsed, failures are reported, never thrown', async () => {
  const calls = [];
  const ok = await fetchCityConfig('schlunsen', { fetchImpl: async (url, init) => { calls.push([url, init]); return response(JSON.stringify(EXAMPLE)); } });
  assert.deepEqual(ok, { found: true, raw: EXAMPLE, error: null, repo: 'schlunsen/schlunsen' });
  assert.equal(calls[0][0], 'https://raw.githubusercontent.com/schlunsen/schlunsen/HEAD/.git-city/city.json');
  assert.equal(calls[0][1].credentials, 'omit');

  assert.deepEqual(await fetchCityConfig('schlunsen', { fetchImpl: async () => response('404: Not Found', { status: 404 }) }), { found: false, raw: null, error: null });
  assert.match((await fetchCityConfig('schlunsen', { fetchImpl: async () => response('oops', { status: 500 }) })).error, /HTTP 500/);
  const broken = await fetchCityConfig('schlunsen', { fetchImpl: async () => response('{ nope') });
  assert.equal(broken.found, true);
  assert.match(broken.error, /not valid JSON/);
  const big = await fetchCityConfig('schlunsen', { fetchImpl: async () => response('x'.repeat(MAX_BYTES + 10)) });
  assert.match(big.error, /larger than 32 KB/);
  const lying = await fetchCityConfig('schlunsen', { fetchImpl: async () => response('{}', { headers: { 'content-length': String(10 * MAX_BYTES) } }) });
  assert.match(lying.error, /larger than 32 KB/);
  const thrown = await fetchCityConfig('schlunsen', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.match(thrown.error, /Failed to fetch/);
});

test('fetchCityConfig: times out, honours an abort signal and refuses bad logins without a request', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const t0 = Date.now();
  const slow = await fetchCityConfig('schlunsen', { fetchImpl: hang, timeout: 50 });
  assert.match(slow.error, /timed out/);
  assert.ok(Date.now() - t0 < 1000);
  const ctrl = new AbortController();
  const p = fetchCityConfig('schlunsen', { fetchImpl: hang, signal: ctrl.signal, timeout: 5000 });
  ctrl.abort();
  assert.doesNotMatch((await p).error, /timed out/);
  let called = false;
  const none = await fetchCityConfig('../../etc/passwd', { fetchImpl: async () => { called = true; return response('{}'); } });
  assert.deepEqual(none, { found: false, raw: null, error: null });
  assert.equal(called, false);
});

test('serializeCityConfig round-trips through the validator', () => {
  const { config } = norm(EXAMPLE);
  const text = serializeCityConfig(config);
  const again = norm(parseCityConfigText(text).raw);
  assert.deepEqual(again.warnings, []);
  assert.deepEqual(plain(again.config), plain(config));
  assert.equal(JSON.parse(serializeCityConfig(norm({}).config, { schema: false })).version, 1);
  assert.deepEqual(Object.keys(JSON.parse(serializeCityConfig(norm({ welcome: 'hi' }).config))), ['$schema', 'version', 'welcome']);
});

test('publish URLs go to GitHub\'s own editor', () => {
  const json = serializeCityConfig(norm(EXAMPLE).config);
  const url = new URL(newFileUrl('schlunsen', json, 'main'));
  assert.equal(url.origin + url.pathname, 'https://github.com/schlunsen/schlunsen/new/main');
  assert.equal(url.searchParams.get('filename'), '.git-city/city.json');
  assert.equal(url.searchParams.get('value'), json);
  assert.equal(editFileUrl('schlunsen', 'main'), 'https://github.com/schlunsen/schlunsen/edit/main/.git-city/city.json');
  assert.equal(editFileUrl('schlunsen'), 'https://github.com/schlunsen/schlunsen/edit/HEAD/.git-city/city.json');
  assert.equal(newFileUrl('a', '{}', 'release/v1').split('?')[0], 'https://github.com/a/a/new/release/v1');
  assert.equal(configUrl('antfu'), 'https://raw.githubusercontent.com/antfu/antfu/HEAD/.git-city/city.json');
});

test('the vocabulary matches the code it names (world.js, city/layout.js, attractions.js)', () => {
  assert.deepEqual([...OPTIONS.biome].sort(), Object.keys(BIOMES).sort());
  assert.deepEqual([...OPTIONS.landmark].sort(), ATTRACTIONS.map((a) => a.key).sort());
  assert.deepEqual([...OPTIONS.shape], CITY_SHAPE_NAMES);
  assert.deepEqual([...OPTIONS.horizon].sort(), [...HORIZON_NAMES].sort());
  assert.deepEqual([...OPTIONS.buildings].sort(), [...THEME_NAMES].sort());
});

test('every landmark has island sites that can hold it (world.js LANDMARK_SITES vs attractions.js)', () => {
  assert.deepEqual(Object.keys(LANDMARK_SITES).sort(), [...OPTIONS.landmark].sort());
  for (const a of ATTRACTIONS) {
    const sites = LANDMARK_SITES[a.key];
    assert.ok(sites.length, a.key);
    for (const s of sites) {
      const kind = SITE_KINDS[s.replace(/\d+$/, '')];
      assert.ok(kind, `${a.key}: unknown site ${s}`);
      assert.ok(a.tags.includes(kind.tag), `${a.key} (${a.tags}) can't stand on a ${kind.tag} site`);
      assert.ok(a.radius <= kind.r + 1.5, `${a.key} (r ${a.radius}) doesn't fit ${s} (r ${kind.r})`);
    }
  }
});

test('the JSON Schema agrees with the validator', () => {
  const schema = JSON.parse(readFileSync(new URL('../public/schema/city-config.v1.json', import.meta.url), 'utf8'));
  const P = schema.properties;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(P).sort(), Object.keys(EXAMPLE).concat('$schema').sort());
  assert.deepEqual(P.island.properties.biome.enum, [...OPTIONS.biome]);
  assert.deepEqual(P.island.properties.shape.enum, [...OPTIONS.shape]);
  assert.deepEqual(P.island.properties.buildings.enum, [...OPTIONS.buildings]);
  assert.deepEqual(P.landmarks.items.enum, [...OPTIONS.landmark]);
  assert.deepEqual(P.look.properties.time.enum, [...OPTIONS.time]);
  assert.deepEqual(P.look.properties.weather.enum, [...OPTIONS.weather]);
  assert.deepEqual(P.repos.additionalProperties.properties.style.enum, [...OPTIONS.style]);
  assert.deepEqual(P.player.properties.music.enum, [...OPTIONS.music]);
  assert.equal(P.island.properties.name.maxLength, LIMITS.name);
  assert.equal(P.welcome.maxLength, LIMITS.text);
  assert.equal(P.repos.additionalProperties.properties.sign.maxLength, LIMITS.sign);
  assert.equal(P.repos.additionalProperties.properties.billboard.maxLength, LIMITS.text);
  assert.equal(P.plane.properties.name.maxLength, LIMITS.planeName);
  for (const k of ['neighbours', 'featured', 'hide', 'landmarks']) assert.equal(P[k].maxItems, LIMITS[k], k);
  assert.equal(P.repos.maxProperties, LIMITS.repos);
  assert.deepEqual([P.player.properties.volume.minimum, P.player.properties.volume.maximum], LIMITS.volume);
  const re = (d) => new RegExp(schema.$defs[d].pattern);
  for (const s of ['#8c78ff', '#8C78FF', '#fff', 'red']) assert.equal(re('color').test(s), /^#[0-9a-f]{6}$/i.test(s), s);
  for (const s of ['ok-name', '-a', 'a-', 'a--b', 'x'.repeat(39), 'x'.repeat(40)]) {
    assert.equal(re('login').test(s), normalizeCityConfig({ neighbours: [s] }).config.neighbours.length === 1, s);
  }
});

// ---- per-building config: city.json repos[name] and a repo's .git-city/building.json ----
const BUILDING = {
  style: 'stepped', color: '#e4574f', sign: 'you are here', billboard: 'Watch it grow',
  graffiti: { text: 'ship it!', color: '#ff5ab4', style: 'bubble' }, roof: 'garden', neon: '#8c78ff', flag: '🏴\u200d☠️',
};

test('building fields: a full entry survives, in city.json and in building.json', () => {
  const { config, warnings } = norm({ repos: { 'git-city': BUILDING } });
  assert.deepEqual(warnings, []);
  assert.deepEqual(plain(config.repos['git-city']), BUILDING);
  const mine = normalizeBuildingConfig({ $schema: 'x', version: 1, ...BUILDING });
  assert.deepEqual(mine.warnings, []);
  assert.deepEqual(plain(mine.config), BUILDING);
  assert.deepEqual(Object.keys(normalizeBuildingConfig({}).config), []);
});

test('building fields: bad values are dropped with warnings', () => {
  const { config, warnings } = normalizeBuildingConfig({
    style: 'castle', roof: 'moon', neon: 'hotpink', flag: 7, color: '#fff',
    graffiti: { text: 42, color: 'red', style: 'wildstyle', font: 'Comic Sans' }, src: 'https://evil.example/x.png',
  });
  assert.deepEqual(plain(config), {});
  for (const k of ['style', 'roof', 'neon', 'flag', 'color', 'graffiti.text', 'graffiti.color', 'graffiti.style', '"font"', '"src"']) {
    assert.ok(warnings.some((w) => w.includes(k)), k);
  }
  assert.ok(normalizeBuildingConfig({ graffiti: { color: '#ffffff' } }).warnings.some((w) => w.includes('needs "text"')));
  assert.ok(normalizeBuildingConfig({ graffiti: 'ship it' }).warnings.some((w) => w.includes('expected an object')));
  assert.deepEqual(plain(normalizeBuildingConfig({ roof: 'auto', style: 'auto' }).config), {}, 'auto is the default, not stored');
});

test('graffiti: oversized text is capped, controls stripped, markup kept as inert text', () => {
  const long = 'x'.repeat(5000);
  const { config, warnings } = normalizeBuildingConfig({ graffiti: { text: `  ${long}\n` } });
  assert.equal(config.graffiti.text.length, LIMITS.graffiti);
  assert.ok(warnings.some((w) => w.includes('graffiti.text: shortened')));
  assert.equal(normalizeBuildingConfig({ graffiti: { text: 'a\u202eb c' } }).config.graffiti.text, 'ab c');
  assert.equal(normalizeBuildingConfig({ graffiti: { text: '<script>alert(1)</script>' } }).config.graffiti.text, '<script>alert(1)</script>');
  assert.equal(normalizeBuildingConfig({ graffiti: { text: '   ' } }).config.graffiti, undefined);
  // An oversized building.json is refused before parsing.
  assert.match(parseCityConfigText(`{"graffiti":{"text":"${'y'.repeat(BUILDING_MAX_BYTES)}"}}`, { maxBytes: BUILDING_MAX_BYTES, name: 'building.json' }).error, /building.json is larger than 16 KB/);
});

test('flag: an emoji counts as one character, at most three', () => {
  const f = (v) => normalizeBuildingConfig({ flag: v });
  assert.equal(f('🇩🇰').config.flag, '🇩🇰');
  assert.equal(f('👩\u200d💻').config.flag, '👩\u200d💻');
  assert.equal(f('GC!').config.flag, 'GC!');
  assert.equal(f('ABCDE').config.flag, 'ABC');
  assert.ok(f('ABCDE').warnings.some((w) => w.includes('flag')));
  assert.equal(f('🇩🇰🇸🇪🇳🇴🇫🇮').config.flag, '🇩🇰🇸🇪🇳🇴');
  assert.equal(f('a b').config.flag, 'ab');
  assert.equal(f('').config.flag, undefined);
  assert.ok(Array.from(f('😀'.repeat(40)).config.flag).length <= LIMITS.flagCodePoints);
});

test('building.json: prototype pollution and wrong roots go nowhere', () => {
  const raw = JSON.parse('{"__proto__": {"polluted": 1, "roof": "pool"}, "constructor": {"prototype": {"polluted": 1}}, "graffiti": {"__proto__": {"text": "proto"}, "text": "real"}}');
  const { config } = normalizeBuildingConfig(raw);
  assert.equal(({}).polluted, undefined);
  assert.equal(config.roof, undefined);
  assert.deepEqual(plain(config), { graffiti: { text: 'real' } });
  assert.ok(!Object.prototype.hasOwnProperty.call(config, '__proto__'));
  // Inherited values are never read, even if something else polluted a prototype.
  Object.prototype.roof = 'pool';
  try {
    const c = normalizeBuildingConfig({ graffiti: { style: 'tag' } }).config;
    assert.ok(!Object.hasOwn(c, 'roof'), 'the inherited roof is not copied in');
    assert.equal(c.graffiti, undefined, 'graffiti without its own text is dropped');
  } finally { delete Object.prototype.roof; }
  for (const root of [null, [], 'x', 3]) assert.equal(normalizeBuildingConfig(root).config, null);
});

test('the owner\'s city.json entry wins over building.json, field by field', () => {
  const repoFile = { graffiti: { text: 'from the repo' }, roof: 'solar', neon: '#00ff00', flag: 'R' };
  const owner = { roof: 'helipad', color: '#123456' };
  assert.deepEqual(mergeBuildingConfig(owner, repoFile), { color: '#123456', graffiti: { text: 'from the repo' }, roof: 'helipad', neon: '#00ff00', flag: 'R' });
  assert.deepEqual(mergeBuildingConfig(null, repoFile), repoFile);
  assert.deepEqual(mergeBuildingConfig(owner, null), owner);
  assert.deepEqual(mergeBuildingConfig(null, null), {});
  assert.deepEqual([...BUILDING_KEYS].sort(), Object.keys(BUILDING).sort());
});

test('fetchBuildingConfig: raw URL, 16 KB cap, 404, bad names never requested', async () => {
  const calls = [];
  const ok = await fetchBuildingConfig('schlunsen/git-city', { fetchImpl: async (url) => { calls.push(url); return response(JSON.stringify(BUILDING)); } });
  assert.deepEqual(ok, { found: true, raw: BUILDING, error: null });
  assert.equal(calls[0], 'https://raw.githubusercontent.com/schlunsen/git-city/HEAD/.git-city/building.json');
  assert.deepEqual(await fetchBuildingConfig('a/b', { fetchImpl: async () => response('404', { status: 404 }) }), { found: false, raw: null, error: null });
  assert.match((await fetchBuildingConfig('a/b', { fetchImpl: async () => response('x'.repeat(BUILDING_MAX_BYTES + 1)) })).error, /building.json is larger than 16 KB/);
  let called = false;
  for (const bad of ['a', 'a/b/c', '../x', 'a/..', 'a/.', '-a/b', 'a/b c', '', null]) {
    assert.deepEqual(await fetchBuildingConfig(bad, { fetchImpl: async () => { called = true; return response('{}'); } }), { found: false, raw: null, error: null }, String(bad));
  }
  assert.equal(called, false);
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  assert.match((await fetchBuildingConfig('a/b', { fetchImpl: hang, timeout: 30 })).error, /timed out/);
});

test('every schema field is documented (customize.html builds its reference tables from them)', () => {
  const missing = [];
  const walk = (props, prefix) => {
    for (const [k, v] of Object.entries(props)) {
      if (k === '$schema') continue;
      if (!v.description) missing.push(prefix + k);
      if (v.properties) walk(v.properties, `${prefix}${k}.`);
      if (v.additionalProperties?.properties) walk(v.additionalProperties.properties, `${prefix}${k}.<name>.`);
    }
  };
  for (const f of ['city-config.v1.json', 'building-config.v1.json']) {
    walk(JSON.parse(readFileSync(new URL(`../public/schema/${f}`, import.meta.url), 'utf8')).properties, `${f}: `);
  }
  assert.deepEqual(missing, []);
});

test('serializeBuildingConfig round-trips', () => {
  const text = serializeBuildingConfig(BUILDING);
  const back = normalizeBuildingConfig(JSON.parse(text));
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(plain(back.config), BUILDING);
});

test('the building JSON Schema agrees with the validator and with city-config.v1.json', () => {
  const read = (f) => JSON.parse(readFileSync(new URL(`../public/schema/${f}`, import.meta.url), 'utf8'));
  const city = read('city-config.v1.json'), bld = read('building-config.v1.json');
  const def = bld.$defs.building;
  assert.deepEqual(city.properties.repos.additionalProperties, def, 'repos entries and building.json share one definition');
  assert.deepEqual(Object.keys(def.properties).sort(), [...BUILDING_KEYS].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(bld.properties).filter(([k]) => k !== '$schema' && k !== 'version')), def.properties);
  assert.deepEqual(def.properties.style.enum, [...OPTIONS.style]);
  assert.deepEqual(def.properties.roof.enum, [...OPTIONS.roof]);
  assert.deepEqual(def.properties.graffiti.properties.style.enum, [...OPTIONS.graffiti]);
  assert.equal(def.properties.graffiti.properties.text.maxLength, LIMITS.graffiti);
  assert.equal(def.properties.flag.maxLength, LIMITS.flagCodePoints);
  assert.equal(def.properties.sign.maxLength, LIMITS.sign);
  assert.equal(def.properties.billboard.maxLength, LIMITS.text);
  assert.equal(bld.additionalProperties, false);
  assert.deepEqual(bld.$defs.color, city.$defs.color);
});

test('organizations: city.json falls back to the .github repository, and publishes there', async () => {
  const urls = [];
  const res = await fetchCityConfig('Lunar-Rails', { fetchImpl: async (url) => {
    urls.push(url);
    return url.includes('/.github/') ? response(JSON.stringify(EXAMPLE)) : response('404: Not Found', { status: 404 });
  } });
  assert.equal(res.found, true);
  assert.equal(res.repo, 'Lunar-Rails/.github');
  assert.deepEqual(urls, [configUrl('Lunar-Rails'), configUrl('Lunar-Rails', { org: true })]);
  assert.equal(configUrl('Lunar-Rails', { org: true }), 'https://raw.githubusercontent.com/Lunar-Rails/.github/HEAD/.git-city/city.json');
  assert.equal(configRepo('Lunar-Rails', { org: true }), 'Lunar-Rails/.github');
  assert.equal(configRepo('schlunsen'), 'schlunsen/schlunsen');
  assert.equal(newFileUrl('Lunar-Rails/.github', '{}', 'main').split('?')[0], 'https://github.com/Lunar-Rails/.github/new/main');
  assert.equal(editFileUrl('Lunar-Rails/.github', 'main'), 'https://github.com/Lunar-Rails/.github/edit/main/.git-city/city.json');
  // A developer's profile repository still answers in one request.
  const one = [];
  const mine = await fetchCityConfig('schlunsen', { fetchImpl: async (url) => { one.push(url); return response(JSON.stringify(EXAMPLE)); } });
  assert.equal(mine.repo, 'schlunsen/schlunsen');
  assert.equal(one.length, 1);
});

test('island.horizon picks the far skyline, and only from the known set', () => {
  const { config, warnings } = norm({ island: { horizon: 'skyline' } });
  assert.equal(config.island.horizon, 'skyline');
  assert.deepEqual(warnings, []);
  // Every biome has a default, so leaving it out is the normal case.
  assert.equal(norm({ island: { biome: 'alpine' } }).config.island.horizon, undefined);
  // Anything else is dropped with a warning, like every other named option.
  for (const bad of ['tundra', 'AUTO', 'Skyline', '', 42, null, ['peaks']]) {
    const r = norm({ island: { horizon: bad } });
    assert.equal(r.config.island.horizon, undefined, String(bad));
    assert.equal(r.warnings.length, 1, String(bad));
  }
});

test('island.buildings picks the building theme, and only from the known set', () => {
  const { config, warnings } = norm({ island: { buildings: 'adobe' } });
  assert.equal(config.island.buildings, 'adobe');
  assert.deepEqual(warnings, []);
  assert.equal(norm({ island: { biome: 'savanna' } }).config.island.buildings, undefined);
  for (const bad of ['gothic', 'AUTO', 'Adobe', '', 42, null, ['metro']]) {
    const r = norm({ island: { buildings: bad } });
    assert.equal(r.config.island.buildings, undefined, String(bad));
    assert.equal(r.warnings.length, 1, String(bad));
  }
});

test('every biome draws its building theme from a pool of real themes, and the picks are stable', () => {
  assert.deepEqual(Object.keys(BIOME_THEMES).sort(), Object.keys(BIOMES).sort());
  for (const [biome, pool] of Object.entries(BIOME_THEMES)) {
    assert.ok(pool.length, biome);
    for (const t of pool) assert.ok(THEME_NAMES.includes(t), `${biome}: ${t}`);
  }
  const T = { biome: 'savanna', seed: 12345 };
  const auto = pickBuildingTheme(T, null, '');
  assert.ok(BIOME_THEMES.savanna.includes(auto.name));
  assert.equal(pickBuildingTheme(T, null, '').name, auto.name); // seeded: the same island, the same town
  // The developer's choice beats the pool; the preview parameter beats both.
  assert.equal(pickBuildingTheme(T, { island: { buildings: 'chalet' } }, '').name, 'chalet');
  assert.equal(pickBuildingTheme(T, { island: { buildings: 'chalet' } }, '?buildings=brick').name, 'brick');
  assert.equal(pickBuildingTheme(T, { island: { buildings: 'chalet' } }, '?buildings=gothic').name, 'chalet');
});

test('every biome draws its horizon from a pool of real horizons', () => {
  assert.deepEqual(Object.keys(BIOME_HORIZONS).sort(), Object.keys(BIOMES).sort());
  for (const [biome, pool] of Object.entries(BIOME_HORIZONS)) {
    assert.ok(pool.length >= 3, `${biome} needs a few to choose between, got ${pool.length}`);
    for (const h of pool) assert.ok(HORIZON_NAMES.includes(h), `${biome} names an unknown horizon: ${h}`);
    assert.ok(new Set(pool).size >= 2, `${biome} would always show the same horizon`);
  }
});

test('island.streets: clamped to its range, rounded, and non-numbers warn', () => {
  assert.equal(norm({ version: 1, island: { streets: 6 } }).config.island.streets, 6);
  assert.equal(norm({ version: 1, island: { streets: 99 } }).config.island.streets, 6);
  assert.equal(norm({ version: 1, island: { streets: 1 } }).config.island.streets, 3);
  assert.equal(norm({ version: 1, island: { streets: 4.4 } }).config.island.streets, 4);
  const bad = norm({ version: 1, island: { streets: 'wide' } });
  assert.equal(bad.config.island.streets, undefined);
  assert.equal(bad.warnings.length, 1);
  // Left out entirely, the city keeps the default width.
  assert.equal(norm({ version: 1, island: {} }).config.island.streets, undefined);
});
