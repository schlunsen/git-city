/*
 * Profile data: the GitHub REST calls and the bundled sample snapshots.
 */
import { API, DEFAULT_USER, FIXTURES } from './constants.js';
import { setLoadStatus } from './util.js';

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
export async function fetchJSON(url) {
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
export async function loadFixture(login) {
  const url = FIXTURES[login] || FIXTURES[DEFAULT_USER];
  const res = await fetch(url);
  if (!res.ok) throw new Error('No sample data available.');
  const fx = await res.json();
  const shift = Date.now() - new Date(fx.fetched_at).getTime();
  const events = (fx.events || []).map(e => ({ ...e, created_at: new Date(new Date(e.created_at).getTime() + shift).toISOString() }));
  return { user: fx.user, repos: fx.repos, events, fetchedAt: fx.fetched_at, pinned: Array.isArray(fx.pinned) ? fx.pinned : [],
    tzOffset: Number.isFinite(fx.tz_offset) ? fx.tz_offset : null };
}

export async function loadUser(login) {
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
