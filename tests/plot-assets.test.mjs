import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LOT_ASSET_VERSION } from '../public/city/lots.js';

test('plot release imports stay versioned and permitted by the page CSP', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const source = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source, 'the city has an import map');
  const hash = createHash('sha256').update(source).digest('base64');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(policy?.includes(`'sha256-${hash}'`), 'CSP must allow the exact import map or the city cannot load');
  const { imports } = JSON.parse(source);
  for (const path of ['./world.js', './city/lots.js']) {
    assert.equal(imports[path], `${path}?v=${LOT_ASSET_VERSION}`, 'all consumers share the refreshed module URL');
  }
});
