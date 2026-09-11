#!/usr/bin/env node
/*
 * Refresh the bundled sample profiles in public/fixtures/.
 *
 * The app talks to api.github.com straight from the browser, where the
 * unauthenticated limit is 60 requests/hour per IP. For the featured
 * developers we ship a snapshot instead (user + repos + 90 days of public
 * events, trimmed to the fields the city actually uses), refreshed daily by
 * the GitHub Actions workflow. Run locally with:
 *
 *   GITHUB_TOKEN=$(gh auth token) node scripts/scrape.mjs            # all defaults
 *   node scripts/scrape.mjs torvalds antfu                           # a subset
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Keep in sync with DEFAULT_DEVELOPERS in public/city/constants.js and the example links in index.html.
export const DEFAULT_DEVELOPERS = ['torvalds', 'gaearon', 'sindresorhus', 'tj', 'antfu', 'schlunsen'];

const API = 'https://api.github.com';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/fixtures');
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'git-city-scraper',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function get(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj?.[k]]).filter(([, v]) => v !== undefined));
const trimUser = u => pick(u, ['login', 'name', 'avatar_url', 'html_url', 'bio', 'followers', 'following', 'public_repos', 'created_at']);
const trimRepo = r => ({
  ...pick(r, ['name', 'full_name', 'description', 'html_url', 'language', 'stargazers_count', 'forks_count',
    'watchers_count', 'size', 'fork', 'archived', 'default_branch', 'created_at', 'pushed_at']),
  license: r.license ? { spdx_id: r.license.spdx_id } : null,
  ...(r.parent ? { parent: { full_name: r.parent.full_name } } : {}),
});
// Only the user's own repositories become buildings, so activity elsewhere
// never animates. Keep those events (they still count toward the per-day
// heatmap ring) but drop the repository name — the snapshot then only
// publishes activity on repositories the profile itself owns.
const trimEvent = (e, own) => ({
  type: e.type, created_at: e.created_at, repo: { name: own.has(e.repo?.name) ? e.repo.name : '' },
  payload: e.type === 'PushEvent' ? { size: e.payload?.size ?? e.payload?.commits?.length ?? 1 } : {},
});

// Pinned repositories (the "Pinned" row on a GitHub profile) are only exposed
// through GraphQL, which needs a token: fine here (the Actions GITHUB_TOKEN),
// impossible from the browser. Only the profile's own repos become buildings.
async function pinned(login) {
  if (!process.env.GITHUB_TOKEN) return [];
  try {
    const res = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query($login:String!){user(login:$login){pinnedItems(first:6,types:REPOSITORY){nodes{... on Repository{name owner{login}}}}}}',
        variables: { login },
      }),
    });
    if (!res.ok) return [];
    const nodes = (await res.json())?.data?.user?.pinnedItems?.nodes || [];
    return nodes.filter(n => n?.owner?.login?.toLowerCase() === login.toLowerCase()).map(n => n.name);
  } catch { return []; }
}

// The developer's UTC offset: GitHub doesn't publish a timezone, but a commit
// patch keeps its author's original "Date: ... +0200". Read it from the latest push.
async function tzOffset(events) {
  const push = events.find(e => e.type === 'PushEvent' && e.payload?.head && e.repo?.name);
  if (!push) return null;
  try {
    const res = await fetch(`${API}/repos/${push.repo.name}/commits/${push.payload.head}`, { headers: { ...headers, Accept: 'application/vnd.github.patch' } });
    if (!res.ok) return null;
    const m = (await res.text()).slice(0, 4096).match(/^Date: .* ([+-])(\d{2})(\d{2})$/m);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
  } catch { return null; }
}

export async function scrape(login) {
  const user = await get(`${API}/users/${encodeURIComponent(login)}`);
  const repos = await get(`${API}/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated`);
  const events = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await get(`${API}/users/${encodeURIComponent(login)}/events/public?per_page=100&page=${page}`);
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return {
    fetched_at: new Date().toISOString(),
    user: trimUser(user),
    repos: repos.map(trimRepo),
    events: events.map(e => trimEvent(e, new Set(repos.map(r => r.full_name)))),
    pinned: await pinned(login),
    tz_offset: await tzOffset(events), // minutes east of UTC, or null
  };
}

const logins = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DEVELOPERS;
await mkdir(OUT, { recursive: true });
let failed = 0;
for (const login of logins) {
  try {
    const fx = await scrape(login);
    const file = path.join(OUT, `${login}.json`);
    await writeFile(file, JSON.stringify(fx));
    console.log(`✓ ${login}: ${fx.repos.length} repos, ${fx.events.length} events, pinned [${fx.pinned.join(', ')}], tz ${fx.tz_offset ?? '?'} → ${path.relative(process.cwd(), file)}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${login}: ${e.message}`);
  }
}
process.exit(failed && failed === logins.length ? 1 : 0);
