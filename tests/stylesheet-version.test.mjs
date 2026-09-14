import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// The stylesheet is served from behind a CDN that caches by full URL, so
// ./styles.css?v=N is its cache key and the only thing that busts it. Ship a
// change without bumping N and the deploy lands on the origin, every check
// against the commit passes, and visitors keep the old stylesheet for as long
// as the edge feels like holding it -- which is exactly how a light-mode fix
// sat on the server, "deployed", while nobody could see it.
//
// So the version is pinned to the file's content. Change styles.css and this
// fails with the new hash: bump the ?v= in index.html and paste the hash in.
const STYLESHEET = {
  version: 7,
  sha256: 'a8895e0ed512d6061b346b50b8b3a6fdc7ab2610e2346bf7a86fc0fa8d2c22be',
};

test('the stylesheet version is bumped whenever the stylesheet changes', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url));
  const hash = createHash('sha256').update(css).digest('hex');
  assert.equal(hash, STYLESHEET.sha256,
    `styles.css changed: set sha256 to ${hash} here and bump ?v= to ${STYLESHEET.version + 1} in index.html`);

  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const href = html.match(/<link rel="stylesheet" href="\.\/styles\.css\?v=(\d+)" \/>/);
  assert.ok(href, 'the page loads its stylesheet through a versioned URL');
  assert.equal(Number(href[1]), STYLESHEET.version, 'index.html and this pin must name the same version');
});
