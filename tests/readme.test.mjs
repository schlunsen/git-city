import test from 'node:test';
import assert from 'node:assert/strict';
// README excerpts for the showcase TV (public/city/readme.js): plain text and one
// GitHub-hosted picture, never markup or third-party hosts.
import { readmeImage, markdownExcerpt, readmeExcerpt } from '../public/city/readme.js';

test('readmeImage takes the first real picture, resolved against the repo', () => {
  const md = '[![build](https://img.shields.io/badge/ci-passing-green.svg)](https://ci)\n\n![logo](./docs/logo.png)\n';
  assert.equal(readmeImage(md, 'o/r'), 'https://raw.githubusercontent.com/o/r/HEAD/docs/logo.png');
  // Document order wins across markdown and <img> syntax.
  assert.equal(readmeImage('<img src="shot.gif"> then ![b](b.png)', 'o/r'), 'https://raw.githubusercontent.com/o/r/HEAD/shot.gif');
});

test('readmeImage only returns https GitHub hosts', () => {
  assert.equal(readmeImage('![x](https://example.com/a.png)', 'o/r'), '');
  assert.equal(readmeImage('![x](http://raw.githubusercontent.com/o/r/HEAD/a.png)', 'o/r'), '');
  assert.equal(readmeImage('![x](https://github.com/o/r/blob/main/a.gif)', 'o/r'), 'https://raw.githubusercontent.com/o/r/main/a.gif');
  assert.equal(readmeImage('![x](https://github.com/user-attachments/assets/abc)', 'o/r'), 'https://github.com/user-attachments/assets/abc');
  assert.equal(readmeImage('![x](https://github.com/o/r/issues/1)', 'o/r'), ''); // not a file
  assert.equal(readmeImage('no pictures here', 'o/r'), '');
});

test('markdownExcerpt keeps prose and drops chrome', () => {
  const prose = 'A tiny tool that turns your GitHub profile into a living cartoon city, with buildings.';
  const md = `# Title\n\n[![b](https://img.shields.io/x)](https://y)\n\n${prose}\n\n\`\`\`js\nconst code = 'is not prose, even when it is long enough';\n\`\`\`\n`;
  assert.equal(markdownExcerpt(md), prose);
  assert.equal(markdownExcerpt('Use [the docs](https://x) to learn how this&nbsp;works in practice, it is simple.'),
    'Use the docs to learn how this works in practice, it is simple.');
  assert.equal(markdownExcerpt('This project is sponsored by the lovely people at Example Corp, thank you all.'), '');
  assert.equal(markdownExcerpt('Home, About, Docs, Blog, Contact, Pricing, Careers, Support'), ''); // a row of links
});

test('markdownExcerpt caps the excerpt at two paragraphs and ~460 characters', () => {
  const para = (w) => `${Array.from({ length: 50 }, () => w).join(' ')}.`;
  const out = markdownExcerpt([para('alpha'), para('beta'), para('gamma')].join('\n\n'));
  assert.ok(out.endsWith('…') && out.length <= 458, `${out.length}`);
  assert.ok(!out.includes('gamma'), 'only the first two paragraphs');
});

test('readmeExcerpt without a repo name resolves empty (no network)', async () => {
  assert.deepEqual(await readmeExcerpt({ name: 'x' }), { text: '', image: '' });
});

// The full reader (public/readme-reader.js) is deliberately more permissive than the
// showcase TV: badges and third-party screenshots are shown, scripts and http are not.
test('readmeAsset resolves README pictures and rejects anything that is not https', async () => {
  const { readmeAsset } = await import('../public/readme-reader.js');
  assert.equal(readmeAsset('./docs/logo.png', 'o/r'), 'https://raw.githubusercontent.com/o/r/HEAD/docs/logo.png');
  assert.equal(readmeAsset('https://img.shields.io/badge/ci-green.svg', 'o/r'), 'https://img.shields.io/badge/ci-green.svg');
  assert.equal(readmeAsset('https://github.com/o/r/blob/main/a.gif', 'o/r'), 'https://raw.githubusercontent.com/o/r/main/a.gif');
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://example.com/a.png', '']) assert.equal(readmeAsset(bad, 'o/r'), '');
});
