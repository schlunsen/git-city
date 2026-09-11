import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimeline, paceTimeline, stepIndexAt, actorState, dailyHistogram, activityByRepo, dateParts,
} from '../public/history.js';

const ev = (type, repo, at, payload = {}) => ({ type, repo: { name: repo }, created_at: at, payload });

test('buildTimeline keeps only city repos, sorts ascending and merges bursts', () => {
  const events = [
    ev('PushEvent', 'me/app', '2026-09-02T10:05:00Z', { size: 2 }),
    ev('PushEvent', 'me/app', '2026-09-02T10:00:00Z', { size: 3 }),
    ev('WatchEvent', 'other/thing', '2026-09-01T00:00:00Z'),
    ev('IssuesEvent', 'me/lib', '2026-09-03T00:00:00Z'),
    ev('PushEvent', 'ME/App', '2026-09-02T12:00:00Z', { size: 1 }),
    { type: 'PushEvent', repo: { name: 'me/app' }, created_at: 'garbage' },
  ];
  const { steps, skipped, first, last } = buildTimeline(events, ['me/app', 'me/lib']);
  assert.equal(skipped, 1);
  assert.deepEqual(steps.map(s => [s.repo, s.kind, s.commits, s.count]), [
    ['me/app', 'PushEvent', 5, 2],
    ['me/app', 'PushEvent', 1, 1],
    ['me/lib', 'IssuesEvent', 0, 1],
  ]);
  assert.equal(first, Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(last, Date.parse('2026-09-03T00:00:00Z'));
});

test('paceTimeline compresses real gaps into bounded beats', () => {
  const base = Date.parse('2026-09-01T00:00:00Z');
  const steps = [0, 60e3, 3.6e6, 30 * 86400e3].map(off => ({ ts: base + off, repo: 'r', kind: 'PushEvent', count: 1, commits: 1 }));
  const { duration } = paceTimeline(steps, { minGap: 0.4, maxGap: 1.5, hold: 2 });
  assert.equal(steps[0].at, 0);
  const gaps = steps.slice(1).map((s, i) => s.at - steps[i].at);
  assert.ok(gaps.every(g => g >= 0.4 && g <= 1.5), 'gaps ' + gaps.join(','));
  assert.ok(gaps[0] < gaps[1] && gaps[1] < gaps[2], 'longer real gaps take longer beats');
  assert.equal(duration, steps[3].at + 2);
});

test('stepIndexAt and actorState follow playback time', () => {
  const steps = [{ at: 0 }, { at: 1 }, { at: 2.5 }];
  assert.equal(stepIndexAt(steps, -0.1), -1);
  assert.equal(stepIndexAt(steps, 0), 0);
  assert.equal(stepIndexAt(steps, 2.4), 1);
  assert.equal(stepIndexAt(steps, 99), 2);
  assert.equal(actorState(steps, -1).index, -1);
  const s = actorState(steps, 1.2, { travel: 0.5, act: 1 });
  assert.equal(s.index, 1);
  assert.equal(s.from, 0);
  assert.ok(Math.abs(s.travel - 0.4) < 1e-9);
  assert.ok(Math.abs(s.acting - 0.8) < 1e-9);
  assert.equal(actorState(steps, 5).acting, 0);
  assert.equal(actorState(steps, 0.1).from, null);
});

test('dailyHistogram buckets events oldest-first', () => {
  const now = Date.parse('2026-09-10T12:00:00Z');
  const hist = dailyHistogram([
    ev('PushEvent', 'a/b', '2026-09-10T01:00:00Z'),
    ev('PushEvent', 'a/b', '2026-09-09T23:00:00Z'),
    ev('PushEvent', 'a/b', '2026-09-09T01:00:00Z'),
    ev('PushEvent', 'a/b', '2020-01-01T00:00:00Z'),
  ], 3, now);
  assert.deepEqual(hist, [0, 2, 1]);
});

test('activityByRepo ranks by merged event count; dateParts is UTC', () => {
  assert.deepEqual(activityByRepo([{ repo: 'a', count: 1 }, { repo: 'b', count: 4 }, { repo: 'a', count: 2 }]), [['b', 4], ['a', 3]]);
  assert.deepEqual(dateParts(Date.parse('2026-09-06T23:30:00Z')), { day: '06', month: 'SEP', year: '2026', weekday: 'Sunday', iso: '2026-09-06' });
});
