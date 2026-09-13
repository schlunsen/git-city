/*
 * Constants shared across the city: API endpoints, the bundled sample
 * profiles, the language palette and the activity colours.
 */

export const API = 'https://api.github.com';
export const DEFAULT_USER = 'schlunsen'; // the author's island: the one that carries the sponsors
// Bundled sample profiles, used when GitHub rate-limits us (60 req/h unauthenticated)
// or when the page is opened with ?demo=1. Captured via `gh api`; see fixtures/.
export const DEFAULT_DEVELOPERS = ['torvalds', 'gaearon', 'sindresorhus', 'tj', 'antfu', 'schlunsen'];
export const FIXTURES = Object.fromEntries(DEFAULT_DEVELOPERS.map(u => [u, `./fixtures/${u}.json`]));
export const MAX_BUILDINGS = 100;
export const DAY_CYCLE_SECONDS = 60; // full day->night->day loop
// Companion visualiser: replays a repository's full commit history Gource-style.
export const GOURCE_VIEW = 'https://schlunsen.github.io/gource-view/viewer.html';

// Voxel palette per language. Falls back to gray for unknown languages.
export const LANG_COLORS = {
  typescript: 0x3178c6, javascript: 0xf1e05a, python: 0x3572A5,
  rust: 0xf74c00, go: 0x00add8, c: 0x8a8a99, 'c++': 0x9a73d0,
  'c#': 0x8a63d0, java: 0xe8722a, ruby: 0x8b3133, php: 0x8f949d,
  css: 0xe44fac, html: 0xe34c26, shell: 0x5f8b4b, swift: 0xf05138,
  kotlin: 0x7b52c7, dart: 0x0175c2, scala: 0xc22d40, vue: 0x41b883,
  svelte: 0xff3e00, r: 0x276dc3, matlab: 0xe07020, perl: 0x0298c3,
  'jupyter notebook': 0xd98328, openscad: 0x8a7a5a,
};
export const FALLBACK_COLOR = 0x9aa2b4;

export const ACCENT = 0x64dedb;
export const KIND_COLORS = {
  push: '#64dedb', 'pull req': '#8c78ff', review: '#8c78ff', issue: '#3abeff', comment: '#3abeff',
  star: '#ffa03a', fork: '#ffa03a', release: '#ffa03a', create: '#ffa03a', public: '#ffa03a',
};

export function langHex(lang) {
  return '#' + (LANG_COLORS[(lang || '').toLowerCase()] ?? FALLBACK_COLOR).toString(16).padStart(6, '0');
}
