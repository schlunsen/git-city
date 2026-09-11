import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME, STAGE_LABELS, buildingHp, applyDamage, damageStage, structureAt, hpTone, faceNormal, bombDamage, nextCombo,
  killScore, accuracy, regenBombs, formatStars, formatTime, boxDistance, bestKey,
} from '../public/game.js';

test('tuning constants are frozen and sane', () => {
  assert.ok(Object.isFrozen(GAME));
  assert.equal(GAME.FIRE_RATE, 8);
  assert.equal(GAME.BOMB_MAX, 3);
  assert.equal(GAME.BOMB_RADIUS, 7);
  assert.ok(GAME.BULLET_LIFE > 1 && GAME.BULLET_LIFE < 2);
});

test('building HP grows with height and footprint, within bounds', () => {
  assert.ok(buildingHp(40, 6) > buildingHp(10, 6));
  assert.ok(buildingHp(10, 6) > buildingHp(10, 3));
  assert.equal(buildingHp(0, 0), 16);            // floor
  assert.equal(buildingHp(1000, 100), 420);      // ceiling
  assert.equal(buildingHp('x', null), 16);       // bad input still gives a building
  // A small house dies to about a second of fire; a tower takes a few bombs.
  const house = buildingHp(5, 4), tower = buildingHp(45, 6.4);
  assert.ok(house / GAME.BULLET_DAMAGE <= GAME.FIRE_RATE * 1.5);
  assert.ok(tower > GAME.BOMB_DAMAGE * 2 && tower < GAME.BOMB_DAMAGE * 5);
});

test('damage never takes HP below zero or heals', () => {
  assert.equal(applyDamage(10, 4), 6);
  assert.equal(applyDamage(3, 4), 0);
  assert.equal(applyDamage(10, -5), 10);
  assert.equal(applyDamage(10, NaN), 10);
});

test('bomb damage falls off to zero at the blast radius', () => {
  assert.equal(bombDamage(0), GAME.BOMB_DAMAGE);
  assert.equal(bombDamage(GAME.BOMB_RADIUS), 0);
  assert.equal(bombDamage(GAME.BOMB_RADIUS + 5), 0);
  let prev = Infinity;
  for (let d = 0; d <= GAME.BOMB_RADIUS; d += 0.5) { const v = bombDamage(d); assert.ok(v <= prev); prev = v; }
  assert.equal(bombDamage(-3), GAME.BOMB_DAMAGE); // inside the box counts as ground zero
  assert.equal(bombDamage(2, 0), 0);             // no radius, no damage
});

test('combos build within the window, cap, and reset', () => {
  assert.equal(nextCombo(1, 1), 2);
  assert.equal(nextCombo(2, GAME.COMBO_WINDOW), 3);
  assert.equal(nextCombo(5, GAME.COMBO_WINDOW + 0.01), 1);
  assert.equal(nextCombo(GAME.COMBO_MAX, 0.5), GAME.COMBO_MAX);
  assert.equal(nextCombo(3, -1), 1); // the first kill of a run
});

test('kill score is based on stars and multiplied by the combo', () => {
  assert.equal(killScore(0), 100);
  assert.equal(killScore(248000), 248100);
  assert.equal(killScore(50, 3), 450);
  assert.equal(killScore(-5, 0), 100);
  assert.equal(killScore(12.9, 2), 224);
});

test('accuracy is a capped percentage', () => {
  assert.equal(accuracy(0, 0), 0);
  assert.equal(accuracy(1, 3), 33);
  assert.equal(accuracy(5, 4), 100);
  assert.equal(accuracy(-2, 4), 0);
});

test('bombs regenerate one at a time up to the maximum', () => {
  assert.deepEqual(regenBombs(3, 1.2, 0.5), { bombs: 3, timer: 0 });
  assert.deepEqual(regenBombs(1, 0, 1), { bombs: 1, timer: 1 });
  assert.deepEqual(regenBombs(1, 1.5, 0.6), { bombs: 2, timer: 0.10000000000000009 });
  assert.deepEqual(regenBombs(0, 0, 10), { bombs: 3, timer: 0 });
  assert.deepEqual(regenBombs(2, 0.5, -1), { bombs: 2, timer: 0.5 });
});

test('stars and times format compactly', () => {
  assert.equal(formatStars(248000), '248k');
  assert.equal(formatStars(1500), '1.5k');
  assert.equal(formatStars(1000), '1k');
  assert.equal(formatStars(999), '999');
  assert.equal(formatStars(2300000), '2.3M');
  assert.equal(formatStars(-4), '0');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65.9), '1:05');
  assert.equal(formatTime(-3), '0:00');
});

test('box distance is zero inside and Euclidean outside', () => {
  const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 4, z: 2 } };
  assert.equal(boxDistance({ x: 1, y: 1, z: 1 }, box), 0);
  assert.equal(boxDistance({ x: 5, y: 1, z: 1 }, box), 3);
  assert.equal(boxDistance({ x: 5, y: 8, z: 1 }, box), 5);
});

test('best scores are kept per island, case-insensitively', () => {
  assert.equal(bestKey('Torvalds'), bestKey('torvalds'));
  assert.notEqual(bestKey('torvalds'), bestKey('gaearon'));
  assert.equal(bestKey(undefined), 'gc-bombrun-best:');
});

test('damage stages follow the HP thresholds 80 / 60 / 40 / 20 / 0 %', () => {
  assert.equal(damageStage(100, 100), 0);
  assert.equal(damageStage(80, 100), 0);
  assert.equal(damageStage(79, 100), 1);
  assert.equal(damageStage(59, 100), 2);
  assert.equal(damageStage(39, 100), 3);
  assert.equal(damageStage(19, 100), 4);
  assert.equal(damageStage(1, 100), 4);
  assert.equal(damageStage(0, 100), 5);
  assert.equal(damageStage(10, 0), 5);   // no HP to lose: gone
  assert.equal(STAGE_LABELS.length, 6);
  assert.equal(STAGE_LABELS[1], 'roof gone');
  assert.equal(STAGE_LABELS[5], 'destroyed');
});

test('roof props go first, then towers lose tiers top-down', () => {
  assert.deepEqual(structureAt(3, 0), { roof: true, tiers: 3, cut: 0, lean: false, fire: false, smoke: false, destroyed: false });
  assert.equal(structureAt(3, 1).roof, false);
  assert.equal(structureAt(3, 1).tiers, 3);
  assert.equal(structureAt(3, 2).tiers, 2);
  assert.equal(structureAt(3, 3).tiers, 1);
  assert.equal(structureAt(3, 3).cut, 0);
  assert.equal(structureAt(3, 4).tiers, 1);   // never below one tier until the end...
  assert.equal(structureAt(3, 4).cut, 0.25);  // ...then chunks of it
  assert.equal(structureAt(2, 2).tiers, 1);
  assert.equal(structureAt(2, 3).cut, 0.25);
});

test('single blocks shed height in chunks; low HP leans and burns; zero is destroyed', () => {
  assert.deepEqual([1, 2, 3, 4].map((s) => structureAt(1, s).cut), [0, 0.25, 0.5, 0.6]);
  assert.ok([0, 1, 2, 3, 4].every((s) => structureAt(1, s).tiers === 1));
  assert.equal(structureAt(1, 3).lean, false);
  assert.equal(structureAt(1, 4).lean, true);
  assert.equal(structureAt(1, 4).fire, true);
  assert.equal(structureAt(1, 2).smoke, true);
  assert.equal(structureAt(1, 1).smoke, false);
  assert.deepEqual(structureAt(4, 5), { roof: false, tiers: 0, cut: 1, lean: true, fire: true, smoke: true, destroyed: true });
  // Stages only ever take things away.
  for (const n of [1, 2, 3, 4]) {
    for (let s = 1; s <= 5; s++) {
      const a = structureAt(n, s - 1), b = structureAt(n, s);
      assert.ok(b.tiers <= a.tiers && b.cut >= a.cut && !(b.roof && !a.roof), `tiers ${n}, stage ${s}`);
    }
  }
  assert.equal(structureAt(0, -3).tiers, 1);  // bad input: one intact tier
});

test('HP bar tones: green, yellow, red', () => {
  assert.equal(hpTone(1), 'ok');
  assert.equal(hpTone(0.6), 'ok');
  assert.equal(hpTone(0.59), 'warn');
  assert.equal(hpTone(0.3), 'warn');
  assert.equal(hpTone(0.29), 'bad');
  assert.equal(hpTone(0), 'bad');
});

test('hits land on the nearest face; never the floor', () => {
  const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 10, z: 4 } };
  assert.deepEqual(faceNormal({ x: 0.01, y: 5, z: 2 }, box), { x: -1, y: 0, z: 0 });
  assert.deepEqual(faceNormal({ x: 3.99, y: 5, z: 2 }, box), { x: 1, y: 0, z: 0 });
  assert.deepEqual(faceNormal({ x: 2, y: 9.99, z: 2 }, box), { x: 0, y: 1, z: 0 });
  assert.deepEqual(faceNormal({ x: 2, y: 5, z: 4.01 }, box), { x: 0, y: 0, z: 1 });
  assert.deepEqual(faceNormal({ x: 2, y: 0.01, z: 0.5 }, box), { x: 0, y: 0, z: -1 }); // near the floor: the side
});
