import test from 'node:test';
import assert from 'node:assert/strict';
import { cityArrivalLevels } from '../public/city/city-arrival.js';

test('arrival holds a light slit for the loading cover and opens continuously', () => {
  assert.equal(cityArrivalLevels(0).opening, 0);
  assert.equal(cityArrivalLevels(300).opening, 0);
  let previous = 0;
  for (let ms = 0; ms < 1700; ms += 16) {
    const levels = cityArrivalLevels(ms);
    assert.ok(levels.opening >= previous);
    for (const value of Object.values(levels)) assert.ok(value >= 0 && value <= 1);
    previous = levels.opening;
  }
  assert.equal(cityArrivalLevels(1699).opening, 1);
  assert.ok(cityArrivalLevels(1699).amt < 0.002);
  assert.equal(cityArrivalLevels(1700), null);
  assert.equal(cityArrivalLevels(60000), null);
});

test('reduced motion uses only a crossfade, including a preference change mid-reveal', () => {
  for (const ms of [0, 300, 750, 1500]) {
    const levels = cityArrivalLevels(ms, true);
    assert.equal(levels.opening, 1);
    assert.equal(levels.amt, 0);
  }
  assert.ok(cityArrivalLevels(750).opening < 1);
  assert.ok(cityArrivalLevels(750, true).white > cityArrivalLevels(1500, true).white);
  assert.equal(cityArrivalLevels(1700, true), null);
});
