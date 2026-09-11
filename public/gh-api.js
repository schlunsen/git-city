/*
 * GitHub first, Gitilla's own cache second.
 *
 * A browser gets 60 unauthenticated GitHub requests an hour, which one curious
 * afternoon of clicking through neighbours burns straight through — and then
 * the city is empty. gitilla.com/api mirrors the handful of endpoints a city
 * needs: it keeps what GitHub said, revalidates with ETags, and serves what it
 * has when the quota is gone. So: ask GitHub, and only when GitHub refuses for
 * quota reasons, ask the mirror.
 *
 * The mirror is never asked first. It holds public data that may be minutes
 * old, and GitHub itself is always the fresher answer.
 */

// Same-origin when the page is served from gitilla.com, absolute elsewhere
// (GitHub Pages, or a local dev server).
export const MIRROR =
  globalThis.location?.hostname === 'gitilla.com' ? '/api' : 'https://gitilla.com/api';

/**
 * The mirror path serving the same data as this GitHub URL, or null when the
 * mirror has nothing equivalent (then a failure stays a failure).
 */
export function mirrorFor(url, mirror = MIRROR) {
  let u;
  try { u = new URL(url, 'https://api.github.com'); } catch { return null; }
  if (u.hostname !== 'api.github.com') return null;
  // The mirror serves the first page only. Returning page 1 to a request for
  // page 2 would silently duplicate events, so those are not mirrored.
  const page = u.searchParams.get('page');
  if (page && page !== '1') return null;
  const p = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  const at = (...parts) => `${mirror}/${parts.join('/')}`;
  if (p[0] === 'users' && p.length === 2) return at('users', p[1]);
  if (p[0] === 'users' && p[2] === 'repos') return at('users', p[1], 'repos');
  if (p[0] === 'users' && p[2] === 'events') return at('users', p[1], 'events');
  if (p[0] === 'users' && p[2] === 'following') return at('users', p[1], 'following');
  if (p[0] === 'orgs' && p[2] === 'events') return at('orgs', p[1], 'events');
  if (p[0] === 'orgs' && p[2] === 'public_members') return at('orgs', p[1], 'members');
  if (p[0] === 'repos' && p.length === 3) return at('repos', p[1], p[2]);
  if (p[0] === 'repos' && p[3] === 'contributors') return at('repos', p[1], p[2], 'contributors');
  return null;
}

/** True when GitHub is refusing because the quota is gone, not because the request was wrong. */
export function isQuotaRefusal(res) {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  const left = res.headers?.get?.('x-ratelimit-remaining');
  return left === null || left === undefined || left === '0';
}

/** fetch(), with the mirror as a fallback for quota refusals and network failures. */
export async function ghFetch(url, opts = {}) {
  let res = null;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const alt = mirrorFor(url);
    if (!alt) throw err;
    return fetch(alt, opts); // offline or blocked: the mirror is the only hope
  }
  if (!isQuotaRefusal(res)) return res;
  const alt = mirrorFor(url);
  if (!alt) return res;
  try {
    const cached = await fetch(alt, opts);
    return cached.ok ? cached : res; // a broken mirror must not mask GitHub's answer
  } catch {
    return res;
  }
}
