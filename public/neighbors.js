/*
 * Gitilla — who lives next door.
 *
 * Every island has up to six neighbouring islands, reachable through portal
 * gates out at sea (see world.js setNeighbors / gateFor / arrival). Neighbours
 * are the people a developer follows (an organization's public members); if that's thin, the contributors to
 * their most-starred repo; then the featured developers. The list is cached
 * per login for a week, so the neighbourhood stays put between visits and the
 * unauthenticated GitHub API budget (60 requests/hour) isn't spent twice.
 */

import { ghFetch } from './gh-api.js'; // GitHub first, Gitilla's cache when the quota is gone

const WEEK = 7 * 864e5;

async function getJSON(url, timeout = 5000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await ghFetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/**
 * @param {string} login
 * @param {{ repos?: object[], fallback?: string[], max?: number, pinned?: string[] }} opts
 *   repos: the developer's repos (to find the most-starred one);
 *   fallback: logins to fill up with (e.g. the featured developers);
 *   pinned: neighbours the developer chose in their city.json (validated
 *   logins), placed first; the automatic list only tops them up.
 * @returns {Promise<{ login: string, avatar: string, via: string }[]>}
 */
export async function fetchNeighbors(login, { repos = [], fallback = [], max = 6, pinned = [], org = false } = {}) {
  const self = login.toLowerCase(), pins = [];
  for (const name of pinned) {
    if (pins.length >= max || typeof name !== 'string' || name.toLowerCase() === self) continue;
    if (pins.some((p) => p.login.toLowerCase() === name.toLowerCase())) continue;
    pins.push({ login: name, avatar: `https://github.com/${encodeURIComponent(name)}.png?size=128`, via: 'neighbour' });
  }
  if (pins.length >= max) return pins; // a full hand-picked list costs no API requests
  const auto = await autoNeighbors(login, { repos, fallback, max, org });
  const seen = new Set(pins.map((p) => p.login.toLowerCase()));
  return [...pins, ...auto.filter((n) => !seen.has(n.login.toLowerCase()))].slice(0, max);
}

async function autoNeighbors(login, { repos, fallback, max, org }) {
  const key = `gc-neighbors:${login.toLowerCase()}`;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && Date.now() - cached.t < WEEK && Array.isArray(cached.list)) return cached.list;
  } catch { /* storage unavailable: fetch fresh */ }

  const seen = new Set([login.toLowerCase()]);
  const list = [];
  const push = (u, via) => {
    const name = typeof u === 'string' ? u : u?.login;
    if (!name || list.length >= max) return;
    if (seen.has(name.toLowerCase()) || u?.type === 'Bot' || /\[bot\]$/i.test(name)) return;
    seen.add(name.toLowerCase());
    list.push({ login: name, avatar: u?.avatar_url || `https://github.com/${encodeURIComponent(name)}.png?size=128`, via });
  };

  // A developer's neighbours are who they follow; an organization's are its public members.
  const following = await getJSON(org
    ? `https://api.github.com/orgs/${encodeURIComponent(login)}/public_members?per_page=30`
    : `https://api.github.com/users/${encodeURIComponent(login)}/following?per_page=30`);
  for (const u of following || []) push(u, org ? 'member' : 'follows');

  if (list.length < max) {
    const top = repos.filter((r) => !r.fork).sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))[0];
    if (top?.full_name) {
      const contributors = await getJSON(`https://api.github.com/repos/${top.full_name}/contributors?per_page=20`);
      for (const u of Array.isArray(contributors) ? contributors : []) push(u, `contributes to ${top.name}`);
    }
  }
  for (const name of fallback) push(name, 'featured');

  // Only cache a real answer; a rate-limited empty list would stick for a week.
  if (following || list.length >= max) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), list })); } catch { /* ignore */ }
  }
  return list;
}
