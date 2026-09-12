import test from 'node:test';
import assert from 'node:assert/strict';
import { skyscraperPlan } from '../public/city/skyscrapers.js';

test('all skyscraper silhouettes preserve lot bounds and star-based height', () => {
  for (const h of [28, 40, 65]) for (const f of [2.2, 4, 6, 9]) for (let variant = 0; variant < 5; variant++) {
    const plan = skyscraperPlan(h, f, variant);
    assert.equal(plan.tiers[0].base, 0);
    assert.equal(plan.tiers[0].f, f);
    const last = plan.tiers.at(-1);
    assert.ok(Math.abs(last.base + last.h - h) < 1e-8);
    assert.ok(!last.rotation && !last.shape, 'roof signage needs a square, unrotated surface');
    for (const t of plan.tiers) {
      assert.ok(t.h > 0 && t.f > 0 && t.base >= 0);
      assert.ok(t.base + t.h <= h + 1e-8);
      const angle = t.rotation || 0, depth = t.depth || t.f;
      const widthX = Math.abs(Math.cos(angle)) * t.f + Math.abs(Math.sin(angle)) * depth;
      const widthZ = Math.abs(Math.sin(angle)) * t.f + Math.abs(Math.cos(angle)) * depth;
      assert.ok(Math.abs(t.x) + widthX / 2 <= f / 2 + 1e-8, `${plan.name} exceeds the lot in X`);
      assert.ok(Math.abs(t.z) + widthZ / 2 <= f / 2 + 1e-8, `${plan.name} exceeds the lot in Z`);
    }
  }
});

test('skybridge joins two separated shafts and narrow lots use a tapered tower', () => {
  const { tiers } = skyscraperPlan(40, 6, 1);
  const [, left, bridge, right] = tiers;
  assert.ok(left.x + left.f / 2 < right.x - right.f / 2, 'there must be an open gap');
  assert.ok(bridge.x - bridge.f / 2 < left.x + left.f / 2);
  assert.ok(bridge.x + bridge.f / 2 > right.x - right.f / 2);
  assert.ok(bridge.base > left.base && bridge.base + bridge.h < left.base + left.h);
  assert.equal(skyscraperPlan(40, 3, 1).name, 'obelisk');
});
