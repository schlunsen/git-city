/*
 * Git City — the developer-controlled city config.
 *
 * A developer publishes ONE file in their profile repo:
 *   <login>/<login>/.git-city/city.json
 * and Git City reads it from raw.githubusercontent.com (no API budget, CORS *,
 * ~5 minutes of CDN cache). A 404 means "no config": the automatic city.
 *
 * The file is data, never code. It is parsed with JSON.parse only, then run
 * through normalizeCityConfig(), a pure whitelisting validator: unknown keys
 * are dropped, named options must come from the fixed lists below, colours
 * must be #rrggbb, numbers are clamped, logins follow GitHub's rules, repo
 * names must be the developer's own repos, strings are trimmed, stripped of
 * control characters and capped (the caps protect the layout, not the
 * content: the text itself is free-form). Config text only ever reaches the
 * page through canvas fillText or DOM textContent, and no URL from the config
 * is ever loaded.
 *
 * Everything here is plain data + functions (no DOM), so it runs under
 * `node --test` as well as in the browser. See docs/city-config.md and
 * public/schema/city-config.v1.json (keep the three in step).
 */

export const CONFIG_VERSION = 1;
export const CONFIG_PATH = '.git-city/city.json';
export const MAX_BYTES = 32 * 1024;      // bigger files are ignored unread
export const FETCH_TIMEOUT_MS = 4000;

// ---- vocabulary: the one place the allowed names live ----------------------
// Mirrors world.js BIOMES, app.js CITY_SHAPE_NAMES, attractions.js ATTRACTIONS
// and Gource View's music index (tests/city-config.test.mjs checks the first
// three against the source so they cannot drift).
export const OPTIONS = Object.freeze({
  biome: Object.freeze(['meadow', 'alpine', 'tropical', 'savanna', 'lakeland']),
  shape: Object.freeze(['square', 'wide', 'tall', 'round', 'plus', 'octagon', 'blob']),
  landmark: Object.freeze(['rollerCoaster', 'carousel', 'circusTent', 'dropTower', 'windTurbines', 'windmill',
    'farm', 'campsite', 'radioTower', 'observatory', 'balloonPad']),
  time: Object.freeze(['auto', 'day', 'sunset', 'night', 'cycle']),
  weather: Object.freeze(['clear', 'rain', 'snow']),
  style: Object.freeze(['auto', 'tower', 'block', 'house']),
  music: Object.freeze(['floating-cities', 'deliberate-thought', 'cipher', 'digital-lemonade', 'crypto', 'none']),
});
export const LABELS = Object.freeze({
  biome: { meadow: 'Meadow', alpine: 'Alpine', tropical: 'Tropical', savanna: 'Savanna', lakeland: 'Lakeland' },
  shape: { square: 'Square', wide: 'Wide', tall: 'Tall', round: 'Round', plus: 'Plus', octagon: 'Octagon', blob: 'Blob' },
  landmark: {
    rollerCoaster: 'Roller coaster', carousel: 'Carousel', circusTent: 'Circus tent', dropTower: 'Drop tower',
    windTurbines: 'Wind turbines', windmill: 'Windmill', farm: 'Farm', campsite: 'Campsite', radioTower: 'Radio tower',
    observatory: 'Observatory', balloonPad: 'Balloon pad',
  },
  time: { auto: 'Auto (viewer\'s clock)', day: 'Day', sunset: 'Sunset', night: 'Night', cycle: '60 s cycle' },
  weather: { clear: 'Clear', rain: 'Rain', snow: 'Snow' },
  style: { auto: 'Automatic', tower: 'Stepped tower', block: 'Plain block', house: 'Pitched roof' },
  music: {
    'floating-cities': 'Floating Cities', 'deliberate-thought': 'Deliberate Thought', cipher: 'Cipher',
    'digital-lemonade': 'Digital Lemonade', crypto: 'Crypto', none: 'No music',
  },
});

// Caps that keep the island readable. Text is free-form within them.
export const LIMITS = Object.freeze({
  text: 120,        // welcome, billboard
  name: 40,         // island.name
  sign: 40,         // repos[name].sign
  planeName: 24,    // plane.name
  neighbours: 6,
  featured: 12,
  hide: 50,
  landmarks: 6,
  repos: 100,
  volume: [0, 100],
});

export const HEX_RE = /^#[0-9a-f]{6}$/i;
export const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// C0/C1 controls, DEL, bidi overrides/isolates, zero-width space, LRM/RLM, BOM.
// (ZWJ / ZWNJ stay: emoji sequences need them.)
const STRIP_RE = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;
const TOP_KEYS = ['$schema', 'version', 'island', 'welcome', 'look', 'landmarks', 'neighbours', 'featured', 'hide', 'repos', 'player', 'plane'];
const DID_YOU_MEAN = { neighbors: 'neighbours', landmark: 'landmarks', feature: 'featured', hidden: 'hide', music: 'player.music', accent: 'look.accent', name: 'island.name', biome: 'island.biome', shape: 'island.shape' };

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (s) => JSON.stringify(cleanText(String(s), 40));
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Collapse whitespace, strip control / bidi characters, trim, cap by code points. */
export function cleanText(s, max) {
  // Tabs / newlines become spaces first, then the invisible characters go
  // (before the \s collapse: JS counts U+FEFF as whitespace).
  const t = String(s).replace(/[\t\n\v\f\r]+/g, ' ').replace(STRIP_RE, '').replace(/\s+/g, ' ').trim();
  const cps = Array.from(t);
  return cps.length > max ? cps.slice(0, max).join('').trimEnd() : t;
}

/**
 * Validate + normalise a parsed city.json (or a draft from the Customize panel).
 * Pure: never throws, never mutates `raw`.
 *
 * @param {unknown} raw  the JSON.parse result
 * @param {{ repos?: {name: string}[], login?: string }} [ctx]
 *   repos: the developer's repositories (names are matched against them, case-insensitively);
 *   login: the profile's login (dropped from its own neighbours).
 * @returns {{ config: object|null, warnings: string[] }}
 *   config is null when the root is unusable; otherwise every container is
 *   present (island, look, player, plane objects; landmarks, neighbours,
 *   featured, hide arrays; repos a null-prototype map keyed by canonical repo
 *   name) and leaves appear only when valid.
 */
export function normalizeCityConfig(raw, ctx = {}) {
  const warnings = [];
  const warn = (msg) => { if (warnings.length < 50) warnings.push(msg); };
  if (!isObj(raw)) return { config: null, warnings: [`city.json must be a JSON object, got ${typeOf(raw)}`] };

  const config = {
    version: CONFIG_VERSION, island: {}, look: {}, landmarks: [], neighbours: [], featured: [], hide: [],
    repos: Object.create(null), player: {}, plane: {},
  };

  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.includes(k)) warn(`unknown key ${show(k)} ignored${DID_YOU_MEAN[k] ? ` (did you mean "${DID_YOU_MEAN[k]}"?)` : ''}`);
  }
  if (own(raw, 'version') && raw.version !== CONFIG_VERSION) warn(`version ${show(raw.version)} is not supported; reading the v1 fields`);

  // Readers for one field each: they return undefined (and warn) when the value is unusable.
  const text = (v, path, max) => {
    if (v === undefined) return undefined;
    if (typeof v !== 'string') { warn(`${path}: expected text, got ${typeOf(v)}`); return undefined; }
    const t = cleanText(v, max);
    if (Array.from(v.trim()).length > max) warn(`${path}: shortened to ${max} characters`);
    return t || undefined;
  };
  const pick = (v, path, list) => {
    if (v === undefined) return undefined;
    if (typeof v === 'string' && list.includes(v)) return v;
    warn(`${path}: ${show(v)} is not one of ${list.join(', ')}`);
    return undefined;
  };
  const colour = (v, path) => {
    if (v === undefined) return undefined;
    if (typeof v === 'string' && HEX_RE.test(v)) return v.toLowerCase();
    warn(`${path}: expected a colour like "#8c78ff", got ${show(v)}`);
    return undefined;
  };
  const number = (v, path, [lo, hi]) => {
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) { warn(`${path}: expected a number, got ${typeOf(v)}`); return undefined; }
    const n = Math.round(Math.min(hi, Math.max(lo, v)));
    if (n !== v) warn(`${path}: ${v} clamped to ${n}`);
    return n;
  };
  const flag = (v, path) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    warn(`${path}: expected true or false, got ${typeOf(v)}`);
    return undefined;
  };
  const object = (v, path) => {
    if (v === undefined) return null;
    if (!isObj(v)) { warn(`${path}: expected an object, got ${typeOf(v)}`); return null; }
    return v;
  };
  const unknown = (o, keys, path) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) warn(`${path}: unknown key ${show(k)} ignored`);
  };
  const list = (v, path, max, each) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) { warn(`${path}: expected a list, got ${typeOf(v)}`); return []; }
    const out = [], seen = new Set();
    for (const item of v.slice(0, 400)) { // a 32 KB file can't hold much more; don't walk absurd arrays
      const val = each(item);
      if (val === undefined) continue;
      const key = String(val).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (out.length >= max) { warn(`${path}: only the first ${max} are used`); break; }
      out.push(val);
    }
    return out;
  };

  // Repository names: case-insensitive match against the developer's repos when known.
  const byLower = new Map();
  const known = Array.isArray(ctx.repos);
  if (known) for (const r of ctx.repos) if (r && typeof r.name === 'string') byLower.set(r.name.toLowerCase(), r.name);
  const repoName = (v, path) => {
    if (typeof v !== 'string' || !REPO_RE.test(v)) { warn(`${path}: ${show(v)} is not a repository name`); return undefined; }
    if (!known) return v;
    const hit = byLower.get(v.toLowerCase());
    if (!hit) warn(`${path}: ${show(v)} is not one of this profile's repositories`);
    return hit;
  };
  const self = typeof ctx.login === 'string' ? ctx.login.toLowerCase() : null;

  // island
  const island = object(raw.island, 'island');
  if (island) {
    unknown(island, ['name', 'biome', 'shape'], 'island');
    const name = text(island.name, 'island.name', LIMITS.name);
    const biome = pick(island.biome, 'island.biome', OPTIONS.biome);
    const shape = pick(island.shape, 'island.shape', OPTIONS.shape);
    if (name) config.island.name = name;
    if (biome) config.island.biome = biome;
    if (shape) config.island.shape = shape;
  }
  const welcome = text(raw.welcome, 'welcome', LIMITS.text);
  if (welcome) config.welcome = welcome;

  // look
  const look = object(raw.look, 'look');
  if (look) {
    unknown(look, ['accent', 'time', 'weather', 'tv', 'fx'], 'look');
    const accent = colour(look.accent, 'look.accent');
    const time = pick(look.time, 'look.time', OPTIONS.time);
    const weather = pick(look.weather, 'look.weather', OPTIONS.weather);
    const tv = flag(look.tv, 'look.tv');
    const fx = flag(look.fx, 'look.fx');
    if (accent) config.look.accent = accent;
    if (time) config.look.time = time;
    if (weather) config.look.weather = weather;
    if (tv !== undefined) config.look.tv = tv;
    if (fx !== undefined) config.look.fx = fx;
  }

  config.landmarks = list(raw.landmarks, 'landmarks', LIMITS.landmarks, (v) => pick(v, 'landmarks', OPTIONS.landmark));
  config.neighbours = list(raw.neighbours, 'neighbours', LIMITS.neighbours, (v) => {
    if (typeof v !== 'string' || !LOGIN_RE.test(v)) { warn(`neighbours: ${show(v)} is not a GitHub login`); return undefined; }
    if (self && v.toLowerCase() === self) { warn('neighbours: you are already here'); return undefined; }
    return v;
  });
  config.hide = list(raw.hide, 'hide', LIMITS.hide, (v) => repoName(v, 'hide'));
  const hidden = new Set(config.hide.map((n) => n.toLowerCase()));
  config.featured = list(raw.featured, 'featured', LIMITS.featured, (v) => {
    const n = repoName(v, 'featured');
    if (n && hidden.has(n.toLowerCase())) { warn(`featured: ${show(n)} is also hidden; hide wins`); return undefined; }
    return n;
  });

  // repos: per-repository settings
  const repos = object(raw.repos, 'repos');
  if (repos) {
    let n = 0;
    for (const key of Object.keys(repos)) {
      const name = repoName(key, 'repos');
      if (!name) continue;
      if (own(config.repos, name)) continue;
      if (n >= LIMITS.repos) { warn(`repos: only the first ${LIMITS.repos} entries are used`); break; }
      const path = `repos.${cleanText(name, 40)}`;
      const r = object(repos[key], path);
      if (!r) continue;
      unknown(r, ['style', 'color', 'sign', 'billboard'], path);
      const entry = {};
      const style = pick(r.style, `${path}.style`, OPTIONS.style);
      const color = colour(r.color, `${path}.color`);
      const sign = text(r.sign, `${path}.sign`, LIMITS.sign);
      const billboard = text(r.billboard, `${path}.billboard`, LIMITS.text);
      if (style && style !== 'auto') entry.style = style;
      if (color) entry.color = color;
      if (sign) entry.sign = sign;
      if (billboard) entry.billboard = billboard;
      if (Object.keys(entry).length) { config.repos[name] = entry; n++; }
    }
  }

  // player (the embedded Gource View player)
  const player = object(raw.player, 'player');
  if (player) {
    unknown(player, ['music', 'volume'], 'player');
    const music = pick(player.music, 'player.music', OPTIONS.music);
    const volume = number(player.volume, 'player.volume', LIMITS.volume);
    if (music) config.player.music = music;
    if (volume !== undefined) config.player.volume = volume;
  }

  // plane (the explore-mode biplane)
  const plane = object(raw.plane, 'plane');
  if (plane) {
    unknown(plane, ['color', 'name'], 'plane');
    const color = colour(plane.color, 'plane.color');
    const name = text(plane.name, 'plane.name', LIMITS.planeName);
    if (color) config.plane.color = color;
    if (name) config.plane.name = name;
  }

  return { config, warnings };
}

/** True when a normalised config sets nothing at all. */
export function isEmptyConfig(c) {
  return !c || (!c.welcome && !Object.keys(c.island).length && !Object.keys(c.look).length && !c.landmarks.length
    && !c.neighbours.length && !c.featured.length && !c.hide.length && !Object.keys(c.repos).length
    && !Object.keys(c.player).length && !Object.keys(c.plane).length);
}

/**
 * A normalised config as the canonical city.json text: fixed key order, empty
 * sections left out, pretty-printed. What the Customize panel publishes.
 */
export function serializeCityConfig(c, { schema = true } = {}) {
  const out = {};
  if (schema) out.$schema = 'https://schlunsen.github.io/git-city/schema/city-config.v1.json';
  out.version = CONFIG_VERSION;
  if (c) {
    if (Object.keys(c.island).length) out.island = { ...c.island };
    if (c.welcome) out.welcome = c.welcome;
    if (Object.keys(c.look).length) out.look = { ...c.look };
    for (const k of ['landmarks', 'neighbours', 'featured', 'hide']) if (c[k].length) out[k] = [...c[k]];
    const names = Object.keys(c.repos);
    if (names.length) out.repos = Object.fromEntries(names.map((n) => [n, { ...c.repos[n] }]));
    if (Object.keys(c.player).length) out.player = { ...c.player };
    if (Object.keys(c.plane).length) out.plane = { ...c.plane };
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Parse city.json text. Size is checked before parsing; any failure is an
 * error string, never a throw.
 * @returns {{ raw: unknown, error: string|null }}
 */
export function parseCityConfigText(text) {
  if (typeof text !== 'string') return { raw: null, error: 'city.json could not be read' };
  if (text.length > MAX_BYTES) return { raw: null, error: `city.json is larger than ${MAX_BYTES / 1024} KB` };
  try {
    return { raw: JSON.parse(text.replace(/^\uFEFF/, '')), error: null };
  } catch (e) {
    return { raw: null, error: `city.json is not valid JSON (${cleanText(e?.message || 'parse error', 100)})` };
  }
}

export function configUrl(login) {
  return `https://raw.githubusercontent.com/${login}/${login}/HEAD/${CONFIG_PATH}`;
}

// Read at most `max` bytes of a response body; null when it is longer.
async function readCapped(res, max) {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > max) return null;
  if (!res.body?.getReader) {
    const t = await res.text();
    return t.length > max ? null : t;
  }
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

/**
 * Fetch <login>/<login>/.git-city/city.json from raw.githubusercontent.com.
 * Never throws. `found` says whether the file exists; `raw` is the parsed
 * JSON (not yet validated: pass it to normalizeCityConfig); `error` is set
 * when the file exists but can't be used, or the request failed.
 *
 * @param {string} login
 * @param {{ signal?: AbortSignal, timeout?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ found: boolean, raw: unknown, error: string|null }>}
 */
export async function fetchCityConfig(login, { signal, timeout = FETCH_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) return { found: false, raw: null, error: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    const res = await fetchImpl(configUrl(login), { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (res.status === 404) return { found: false, raw: null, error: null };
    if (!res.ok) return { found: false, raw: null, error: `city.json request failed (HTTP ${res.status})` };
    const text = await readCapped(res, MAX_BYTES);
    if (text === null) return { found: true, raw: null, error: `city.json is larger than ${MAX_BYTES / 1024} KB` };
    const { raw, error } = parseCityConfigText(text);
    return { found: true, raw, error };
  } catch (e) {
    return { found: false, raw: null, error: ctrl.signal.aborted && !signal?.aborted ? 'city.json request timed out' : `city.json request failed (${cleanText(e?.message || e, 80)})` };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

// ---- publishing through GitHub's own editor (no tokens, no OAuth) ----------
export const PROFILE_README_DOCS = 'https://docs.github.com/en/account-and-profile/how-tos/profile-customization/managing-your-profile-readme';
const branchPath = (b) => String(b || 'HEAD').split('/').map(encodeURIComponent).join('/');
/** GitHub's "create new file" page, pre-filled with the JSON. */
export function newFileUrl(login, json, branch = 'HEAD') {
  return `https://github.com/${login}/${login}/new/${branchPath(branch)}?filename=${encodeURIComponent(CONFIG_PATH)}&value=${encodeURIComponent(json)}`;
}
/** GitHub's editor for the existing file (edit URLs can't be pre-filled). */
export function editFileUrl(login, branch = 'HEAD') {
  return `https://github.com/${login}/${login}/edit/${branchPath(branch)}/${CONFIG_PATH}`;
}
/** Where the published file lives on GitHub. */
export function blobUrl(login, branch = 'HEAD') {
  return `https://github.com/${login}/${login}/blob/${branchPath(branch)}/${CONFIG_PATH}`;
}
