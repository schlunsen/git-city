// Where a repository's README actually lives, worked out once.
//
// Raw URLs are case-sensitive and projects disagree: README.md is most common,
// readme.md next (sindresorhus), then the shouty README.MD and the extensionless
// README (torvalds/pesconvert). Every spelling that is not the right one is a
// 404, and a browser prints each of those to the console whatever the code does
// with the response -- so the cost of guessing is paid in visible errors.
//
// Two callers used to guess separately: the showcase TV tried two spellings and
// the in-game reader tried four, for the same repository, so a repo whose file
// is plain README produced up to five 404s before anyone read a word. This
// resolves the name once per repository, remembers it, and hands the same text
// to both. A second reader of the same repo now costs nothing at all.
const inFlight = new Map();

/** The spellings, likeliest first. */
export const README_NAMES = ['README.md', 'readme.md', 'README.MD', 'README'];

/**
 * Resolve and download a repository's README.
 * Returns { status: 'ready'|'missing'|'error', markdown, name }.
 * Never throws.
 *
 * 'ready' and 'missing' are both remembered: four 404s in a row is a fact about
 * the repository, not a bad day on the network, and asking again only reprints
 * the same four errors. Only 'error' -- a refused connection, or the timeout
 * firing mid-hunt -- stays retryable, because that one really might differ next
 * time.
 */
export function readmeSource(fullName, { timeout = 8000 } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName || '')) {
    return Promise.resolve({ status: 'missing', markdown: '', name: '' });
  }
  if (inFlight.has(fullName)) return inFlight.get(fullName);

  const request = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout); // one budget for every spelling
    try {
      for (const name of README_NAMES) {
        const url = `https://raw.githubusercontent.com/${fullName}/HEAD/${name}`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (res.status === 404) continue; // wrong spelling; try the next
        if (!res.ok) return { status: 'error', markdown: '', name: '' };
        return { status: 'ready', markdown: await res.text(), name };
      }
      return { status: 'missing', markdown: '', name: '' };
    } catch {
      return { status: 'error', markdown: '', name: '' };
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlight.set(fullName, request);
  request.then((r) => { if (r.status === 'error') inFlight.delete(fullName); });
  return request;
}
