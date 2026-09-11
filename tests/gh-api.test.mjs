import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorFor, isQuotaRefusal, ghFetch } from '../public/gh-api.js';

const M = 'https://gitilla.com/api';
const headers = (o = {}) => ({ get: (k) => (k in o ? o[k] : null) });

test('every endpoint a city needs has a mirror path', () => {
  assert.equal(mirrorFor('https://api.github.com/users/torvalds'), `${M}/users/torvalds`);
  assert.equal(mirrorFor('https://api.github.com/users/torvalds/repos?per_page=100&sort=updated'), `${M}/users/torvalds/repos`);
  assert.equal(mirrorFor('https://api.github.com/users/torvalds/events/public?per_page=100&page=1'), `${M}/users/torvalds/events`);
  assert.equal(mirrorFor('https://api.github.com/users/torvalds/following?per_page=30'), `${M}/users/torvalds/following`);
  assert.equal(mirrorFor('https://api.github.com/orgs/Lunar-Rails/events?per_page=100'), `${M}/orgs/Lunar-Rails/events`);
  assert.equal(mirrorFor('https://api.github.com/orgs/Lunar-Rails/public_members?per_page=30'), `${M}/orgs/Lunar-Rails/members`);
  assert.equal(mirrorFor('https://api.github.com/repos/torvalds/linux'), `${M}/repos/torvalds/linux`);
  assert.equal(mirrorFor('https://api.github.com/repos/torvalds/linux/contributors?per_page=20'), `${M}/repos/torvalds/linux/contributors`);
});

test('what the mirror cannot serve is not pretended', () => {
  // Page 2 would come back as page 1: duplicated events are worse than none.
  assert.equal(mirrorFor('https://api.github.com/users/torvalds/events/public?page=2'), null);
  assert.equal(mirrorFor('https://api.github.com/repos/a/b/commits/abc123'), null);
  assert.equal(mirrorFor('https://evil.example/users/torvalds'), null);
  assert.equal(mirrorFor('https://raw.githubusercontent.com/a/b/HEAD/x.json'), null);
  assert.equal(mirrorFor('not a url at all'), null);
  assert.equal(mirrorFor('https://api.github.com/users/torvalds/events/public?page=1'), `${M}/users/torvalds/events`);
});

test('a spent quota is told apart from an ordinary refusal', () => {
  assert.equal(isQuotaRefusal({ status: 429, headers: headers() }), true);
  assert.equal(isQuotaRefusal({ status: 403, headers: headers({ 'x-ratelimit-remaining': '0' }) }), true);
  // 403 with quota left is a real refusal (a blocked repo, say): do not mask it.
  assert.equal(isQuotaRefusal({ status: 403, headers: headers({ 'x-ratelimit-remaining': '37' }) }), false);
  assert.equal(isQuotaRefusal({ status: 404, headers: headers() }), false);
  assert.equal(isQuotaRefusal({ status: 200, headers: headers() }), false);
});

test('the mirror is used only once GitHub refuses on quota', async () => {
  const calls = [];
  const stub = (result) => async (url) => { calls.push(url); return result(url); };

  // Happy path: GitHub answers, the mirror is never touched.
  globalThis.fetch = stub(() => ({ ok: true, status: 200, headers: headers() }));
  await ghFetch('https://api.github.com/users/torvalds');
  assert.deepEqual(calls, ['https://api.github.com/users/torvalds']);

  // Quota gone: the mirror answers instead.
  calls.length = 0;
  globalThis.fetch = stub((url) => url.startsWith('https://api.github.com')
    ? { ok: false, status: 403, headers: headers({ 'x-ratelimit-remaining': '0' }) }
    : { ok: true, status: 200, headers: headers(), mirrored: true });
  const res = await ghFetch('https://api.github.com/users/torvalds');
  assert.equal(res.mirrored, true);
  assert.deepEqual(calls, ['https://api.github.com/users/torvalds', `${M}/users/torvalds`]);

  // A 404 is GitHub's real answer and must survive untouched.
  calls.length = 0;
  globalThis.fetch = stub(() => ({ ok: false, status: 404, headers: headers() }));
  assert.equal((await ghFetch('https://api.github.com/users/nope')).status, 404);
  assert.equal(calls.length, 1, 'no mirror call for a 404');
});

test('a broken mirror never masks what GitHub said', async () => {
  globalThis.fetch = async (url) => url.startsWith('https://api.github.com')
    ? { ok: false, status: 403, headers: headers({ 'x-ratelimit-remaining': '0' }), original: true }
    : { ok: false, status: 502, headers: headers() };
  const res = await ghFetch('https://api.github.com/users/torvalds');
  assert.equal(res.original, true, 'GitHub response is returned when the mirror fails');

  // And when the network itself is down, the mirror is still tried.
  let tried = [];
  globalThis.fetch = async (url) => {
    tried.push(url);
    if (url.startsWith('https://api.github.com')) throw new Error('offline');
    return { ok: true, status: 200, headers: headers(), mirrored: true };
  };
  assert.equal((await ghFetch('https://api.github.com/users/torvalds')).mirrored, true);
  assert.equal(tried.length, 2);
});
