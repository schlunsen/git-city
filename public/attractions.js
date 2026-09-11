/*
 * Git City — procedural attractions + landmark objects for the island.
 *
 * No bare imports: the host passes THREE in through `kit`, so this module works in
 * any module context (and in attractions-preview.html) without a bare "three".
 *
 *   kit = { THREE, envMat, ink, rnd }
 *     envMat(nightHex, dayHex, extra?) -> MeshToonMaterial, colour lerped night->day by the host
 *     ink  : shared BackSide MeshBasicMaterial for inverted-hull outlines
 *     rnd  : seeded () => [0,1) — the ONLY source of randomness here
 *
 * Every builder returns { group, update(dt, elapsed), radius }. Each group is
 * built around the local origin, standing on y = 0 (+Y up), with footings that
 * reach down to about y = -1.5 so gently uneven ground never shows a gap.
 * update() only moves/rotates existing objects and tweaks a few uniforms —
 * no per-frame allocation, no geometry rebuilds. All meshes ignore raycasts.
 *
 * This file is the barrel + registry; the builders live in ./attractions/:
 *   kit.js         shared toolkit (tools, chase, seal, bake, finish, rider)
 *   rides.js       roller coaster, carousel, circus tent, drop tower
 *   countryside.js wind turbines, windmill, farm, campsite
 *   landmarks.js   radio tower, observatory, balloon pad
 */

import { buildRollerCoaster, buildCarousel, buildCircusTent, buildDropTower } from './attractions/rides.js';
import { buildWindTurbines, buildWindmill, buildFarm, buildCampsite } from './attractions/countryside.js';
import { buildRadioTower, buildObservatory, buildBalloonPad, buildLighthouse, buildRecordShop, buildRobotMonument } from './attractions/landmarks.js';

export {
  buildRollerCoaster, buildCarousel, buildCircusTent, buildDropTower,
  buildWindTurbines, buildWindmill, buildFarm, buildCampsite,
  buildRadioTower, buildObservatory, buildBalloonPad,
  buildLighthouse, buildRecordShop, buildRobotMonument,
};

// ===========================================================================
// Registry — pick deterministically with the seeded rnd. `radius` is the
// footprint radius (world units); `tags` say where on the island each belongs:
//   fair  — funfair cluster      farm — fields/villages     coast — near the shore
//   hill  — high ground          wild — away from roads
//   flat  — wide footprint that wants near-level ground (> ~1.5 u of relief
//           across it will float or bury an edge)
// windTurbines additionally exposes group.userData.snap: the three turbine
// roots, each safe to terrain-snap on its own.
// ===========================================================================
export const ATTRACTIONS = [
  { key: 'rollerCoaster', build: buildRollerCoaster, radius: 18, weight: 1, tags: ['fair', 'flat'] },
  { key: 'carousel', build: buildCarousel, radius: 5.6, weight: 2, tags: ['fair'] },
  { key: 'circusTent', build: buildCircusTent, radius: 8.4, weight: 1.5, tags: ['fair', 'flat'] },
  { key: 'dropTower', build: buildDropTower, radius: 4, weight: 1, tags: ['fair'] },
  { key: 'windTurbines', build: buildWindTurbines, radius: 15, weight: 1, tags: ['hill', 'coast', 'farm'] },
  { key: 'windmill', build: buildWindmill, radius: 5, weight: 1.5, tags: ['farm', 'hill'] },
  { key: 'farm', build: buildFarm, radius: 12, weight: 1.5, tags: ['farm', 'flat'] },
  { key: 'campsite', build: buildCampsite, radius: 7, weight: 1.5, tags: ['wild', 'coast', 'flat'] },
  { key: 'radioTower', build: buildRadioTower, radius: 5, weight: 1, tags: ['hill', 'wild'] },
  { key: 'observatory', build: buildObservatory, radius: 5.5, weight: 1, tags: ['hill'] },
  { key: 'balloonPad', build: buildBalloonPad, radius: 5.5, weight: 1, tags: ['hill', 'farm', 'fair'] },
  { key: 'lighthouse', build: buildLighthouse, radius: 5, weight: 1, tags: ['coast', 'hill'] },
  { key: 'recordShop', build: buildRecordShop, radius: 6, weight: 1, tags: ['fair', 'flat'] },
  { key: 'robotMonument', build: buildRobotMonument, radius: 5, weight: 1, tags: ['wild', 'hill'] },
];
