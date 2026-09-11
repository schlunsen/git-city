import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
// Exercise the actual browser layout without requiring WebGL or network access.
const layout = source.slice(source.indexOf('const BLOCK ='), source.indexOf('// A canvas-textured'));
const context = vm.createContext({ LANG_COLORS: {}, FALLBACK_COLOR: 0 });
vm.runInContext(layout + ';globalThis.layout = { assignDistricts, worldForCell };', context);

for (const languages of [['TypeScript'], ['Python', 'Go', 'Rust', 'C', 'Java', 'Ruby']]) {
  test(`places all 100 repositories with ${languages.length} language groups`, () => {
    const repos = Array.from({ length: 100 }, (_, i) => ({ name: `repo-${i}`, language: languages[i % languages.length], stargazers_count: 100 - i }));
    const { assignments } = context.layout.assignDistricts(repos);
    assert.equal(assignments.length, 100);
    assert.equal(new Set(assignments.map(a => `${a.gx},${a.gz}`)).size, 100);
    for (const a of assignments) {
      assert.ok(Number.isInteger(a.gx) && Number.isInteger(a.gz), 'buildings sit at lot centers, not road boundaries');
      const { x, z } = context.layout.worldForCell(a.gx, a.gz);
      assert.ok(Math.hypot(Math.max(0, Math.abs(x) - 3.2), Math.max(0, Math.abs(z) - 3.2)) > 15.3, 'footprint clears the plaza');
    }
    assert.equal(JSON.stringify(assignments), JSON.stringify(context.layout.assignDistricts(repos).assignments));
  });
}
