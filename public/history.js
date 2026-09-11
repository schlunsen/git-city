/*
 * Gitilla — activity timeline (Gource-style "code in motion").
 * Pure functions, no DOM / Three.js: the same module drives the 3D actor,
 * the HUD clock and the activity strip, and is unit-tested under node.
 *
 * GitHub's public events feed gives up to 300 events over 90 days. Each event
 * becomes a *step*: the profile's actor flies to the repository it touched and
 * beams at it. Steps are paced like Gource's auto-pace — real gaps are
 * compressed logarithmically so a quiet fortnight takes a beat, not a minute.
 */

export const EVENT_KINDS = {
  PushEvent:                     { label: 'push',      verb: 'pushed to' },
  CreateEvent:                   { label: 'create',    verb: 'created' },
  DeleteEvent:                   { label: 'delete',    verb: 'deleted in' },
  PullRequestEvent:              { label: 'pull req',  verb: 'opened a pull request on' },
  PullRequestReviewEvent:        { label: 'review',    verb: 'reviewed' },
  PullRequestReviewCommentEvent: { label: 'review',    verb: 'reviewed' },
  IssuesEvent:                   { label: 'issue',     verb: 'filed an issue on' },
  IssueCommentEvent:             { label: 'comment',   verb: 'commented on' },
  CommitCommentEvent:            { label: 'comment',   verb: 'commented on' },
  WatchEvent:                    { label: 'star',      verb: 'starred' },
  ForkEvent:                     { label: 'fork',      verb: 'forked' },
  ReleaseEvent:                  { label: 'release',   verb: 'released' },
  PublicEvent:                   { label: 'public',    verb: 'open-sourced' },
  MemberEvent:                   { label: 'member',    verb: 'added a member to' },
  GollumEvent:                   { label: 'wiki',      verb: 'edited the wiki of' },
};

const MERGE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Turn raw GitHub events into ascending, merged steps.
 * @param {Array} events   raw /users/:login/events/public payload
 * @param {Iterable<string>} cityRepos full_name of every repository that has a building
 * @returns {{ steps: Step[], skipped: number, first: number|null, last: number|null }}
 *   Step = { ts, repo, kind, label, verb, commits, count }
 */
export function buildTimeline(events, cityRepos) {
  const inCity = new Map();
  for (const name of cityRepos || []) inCity.set(String(name).toLowerCase(), name);
  const raw = [];
  let skipped = 0, first = null, last = null;
  for (const e of Array.isArray(events) ? events : []) {
    const ts = Date.parse(e?.created_at);
    if (!Number.isFinite(ts)) continue;
    first = first === null ? ts : Math.min(first, ts);
    last = last === null ? ts : Math.max(last, ts);
    const repo = inCity.get(String(e.repo?.name || '').toLowerCase());
    const kind = EVENT_KINDS[e.type];
    if (!repo || !kind) { skipped++; continue; }
    const commits = e.type === 'PushEvent'
      ? Math.max(1, e.payload?.size ?? e.payload?.commits?.length ?? 1)
      : 0;
    raw.push({ ts, repo, kind: e.type, label: kind.label, verb: kind.verb, commits, count: 1 });
  }
  raw.sort((a, b) => a.ts - b.ts);
  const steps = [];
  for (const s of raw) {
    const prev = steps[steps.length - 1];
    if (prev && prev.repo === s.repo && prev.kind === s.kind && s.ts - prev.ts < MERGE_WINDOW_MS) {
      prev.ts = s.ts; prev.commits += s.commits; prev.count += 1;
    } else {
      steps.push({ ...s });
    }
  }
  return { steps, skipped, first, last };
}

/**
 * Assign a playback time (seconds at 1x) to every step. Mutates + returns steps.
 * Gaps grow with the log of the real gap, clamped so the show never stalls.
 */
export function paceTimeline(steps, { minGap = 0.42, maxGap = 1.9, hold = 2.5 } = {}) {
  let at = 0;
  steps.forEach((s, i) => {
    if (i > 0) {
      const hours = Math.max(0, (s.ts - steps[i - 1].ts) / 3.6e6);
      at += Math.min(maxGap, minGap + Math.log1p(hours) * 0.22);
    }
    s.at = at;
  });
  const duration = steps.length ? steps[steps.length - 1].at + hold : 0;
  return { steps, duration };
}

/** Index of the last step whose playback time is <= t, or -1. */
export function stepIndexAt(steps, t) {
  let lo = 0, hi = steps.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].at <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Where the actor is at playback time t (seconds at 1x).
 *   index     step the actor is at / flying to (-1 before the first)
 *   from      previous step (null when arriving from the plaza)
 *   travel    0..1 flight progress
 *   acting    1..0 while beaming at the building, 0 once done
 */
export function actorState(steps, t, { travel = 0.55, act = 0.9 } = {}) {
  const index = stepIndexAt(steps, t);
  if (index < 0) return { index: -1, from: null, travel: 1, acting: 0, since: 0 };
  const since = t - steps[index].at;
  return {
    index,
    from: index > 0 ? index - 1 : null,
    travel: Math.min(1, since / travel),
    acting: since < act ? 1 - since / act : 0,
    since,
  };
}

/** Per-day event counts for the activity strip; index 0 = oldest day. */
export function dailyHistogram(events, days = 90, now = Date.now()) {
  const hist = new Array(days).fill(0);
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  for (const e of Array.isArray(events) ? events : []) {
    const d = new Date(e?.created_at);
    if (Number.isNaN(d.getTime())) continue;
    d.setUTCHours(0, 0, 0, 0);
    const back = Math.round((today - d) / 86400000);
    if (back >= 0 && back < days) hist[days - 1 - back] += 1;
  }
  return hist;
}

/** Repos ranked by how many steps touch them: the "top repositories" list. */
export function activityByRepo(steps) {
  const map = new Map();
  for (const s of steps) map.set(s.repo, (map.get(s.repo) || 0) + s.count);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function dateParts(ts) {
  const d = new Date(ts);
  return {
    day: String(d.getUTCDate()).padStart(2, '0'),
    month: MONTHS[d.getUTCMonth()],
    year: String(d.getUTCFullYear()),
    weekday: DAYS[d.getUTCDay()],
    iso: d.toISOString().slice(0, 10),
  };
}
