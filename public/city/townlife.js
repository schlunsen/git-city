/*
 * Town life that stays up between cities: streetlamps, the plaza fountain, the
 * townsfolk and their dogs, and the weather.
 */
import * as THREE from 'three';
import { scene, clock } from './scene.js';
import { toonMat, getOutlineMat, noRaycast, TAU, box, hullOf, mergeParts, annulusGeo, envMat, seededRandom, makeGlowTexture } from './toon.js';
import { PLAZA_R, BOULEVARD_HALF, makeCityLayout } from './layout.js';
import { PLAZA_Y, POOL, plazaBenchSpots } from './plaza.js';
import { disposeObject } from './util.js';

export let lampGroup = null;   // streetlamps (neon at night)
let fountain = null;           // { group, update(t, day) }
let pedestrians = null;        // { people, dogs, meshes, dogMesh, dogInk, leash }
let weather = null;            // { points, geo, data, rainMat, snowMat, N }
export let weatherMode = 'clear'; // 'clear' | 'rain' | 'snow'

// Streetlamps along the main boulevard with emissive cones that read as neon
// light pools at night.
export function buildStreetlamps(L = makeCityLayout('square')) { // L: the footprint on screen (block.js)
  if (lampGroup) { scene.remove(lampGroup); disposeObject(lampGroup); } // rebuilt with the footprint
  lampGroup = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6);
  const poleMat = toonMat({ color: 0x2a2f3a });
  const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
  // The light cone: apex at the lamp head (y 3.3), open end on the ground, fading
  // from the lamp downward (a cone's uv v runs 1 at the apex to 0 at the rim),
  // plus a soft pool of light on the ground under it.
  const coneGeo = new THREE.ConeGeometry(1.5, 3.25, 24, 1, true).translate(0, 3.25 / 2 + 0.05, 0);
  const headMat = toonMat({ color: 0x1a1a1a, emissive: 0xffd9a0, emissiveIntensity: 0.1 });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffe4b0, alphaMap: lampFade(), transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
  coneMat.userData.peak = 0.3; // night opacity (app.js applyDayFactor)
  const poolGeo = new THREE.CircleGeometry(1.7, 28).rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: makeGlowTexture(64), color: 0xffd9a0, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
  poolMat.userData.peak = 0.55;
  // Two rows along the east-west avenue, out to the sidewalk just past the
  // boulevard on each side (4 units beyond its centreline), whatever the footprint.
  const rowEnd = (z, s) => { let x = 0; while (x < 200 && L.dist(s * x, z) < 4) x += 0.25; return s * x; };
  for (const z of [7.2, -7.2]) {
    const x0 = rowEnd(z, -1), x1 = rowEnd(z, 1);
    for (let i = 0; i <= 8; i++) {
      const x = x0 + (i / 8) * (x1 - x0);
      if (Math.hypot(x, z) < PLAZA_R + 1.5) continue; // the plaza has its own lanterns
      if (Math.abs(L.dist(x, z)) < BOULEVARD_HALF + 0.8) continue; // never on the boulevard or its curb
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 1.6;
      const head = new THREE.Mesh(headGeo, headMat.clone()); head.position.y = 3.3;
      const cone = new THREE.Mesh(coneGeo, coneMat);
      const pool = new THREE.Mesh(poolGeo, poolMat); pool.position.y = 0.04;
      cone.raycast = pool.raycast = noRaycast;
      g.add(pole, head, cone, pool);
      g.position.set(x, 0, z);
      g.userData.mat = head.material;
      lampGroup.add(g);
    }
  }
  scene.add(lampGroup);
  // The light materials (shared by every lamp) fade in with the dusk: applyDayFactor.
  lampGroup.userData.cones = [coneMat, poolMat];
}

// Alpha ramp for the streetlamp cones: brightest at the lamp, faint at the ground.
let lampFadeTex = null;
function lampFade() {
  if (!lampFadeTex) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 64); // canvas top = uv v 1 = the apex
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, '#9a9a9a'); grad.addColorStop(1, '#141414');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
    lampFadeTex = new THREE.CanvasTexture(c);
    lampFadeTex.userData.shared = true;
  }
  return lampFadeTex;
}

// Plaza fountain: a stone-rimmed pool around the monument's steps, cel-banded
// shader water with foam edges (teal underwater glow at night) and eight jets
// arcing from spouts on the rim toward the monument.
export function buildFountain() {
  const g = new THREE.Group();
  const rimMat = envMat(0x3c465a, 0xe2d6bc);
  const rim = new THREE.Mesh(annulusGeo(POOL.rimIn, POOL.rimOut, 0.55, 48), rimMat);
  rim.position.y = PLAZA_Y;
  rim.castShadow = rim.receiveShadow = true;
  const rimHull = new THREE.Mesh(new THREE.CylinderGeometry(POOL.rimOut + 0.1, POOL.rimOut + 0.1, 0.72, 72), getOutlineMat());
  rimHull.position.y = PLAZA_Y + 0.26;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(POOL.rimIn, 0.045, 4, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a0d16 }));
  lip.position.y = PLAZA_Y + 0.55;
  const JETS = 8, PER = 18, N = JETS * PER, jetAng = j => (j + 0.5) * TAU / JETS; // between the footbridges
  const spouts = [];
  for (let j = 0; j < JETS; j++) spouts.push(box(0.3, 0.22, 0.3, Math.cos(jetAng(j)) * 6.85, PLAZA_Y + 0.66, Math.sin(jetAng(j)) * 6.85));
  const spoutMesh = new THREE.Mesh(mergeParts(spouts), rimMat);
  // Water: radial ripples quantised into cel bands, foam hugging the octagonal
  // steps and the rim. Colours are lerped for night by update().
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uGlow: { value: 0 }, uIn: { value: 4.16 }, uOut: { value: POOL.rimIn },
      uDeep: { value: new THREE.Color() }, uLight: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() },
    },
    vertexShader: `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime, uGlow, uIn, uOut; uniform vec3 uDeep, uLight, uFoam;
      varying vec2 vP;
      void main() {
        float r = length(vP), a = atan(vP.y, vP.x);
        vec2 q = abs(vP);
        float oct = max(max(q.x, q.y), (q.x + q.y) * 0.70710678); // distance to the octagonal steps
        float w = sin(r * 5.0 - uTime * 1.7) * 0.55 + sin(a * 11.0 + r * 1.5 + uTime * 0.8) * 0.3 + sin(a * 4.0 - uTime * 0.5) * 0.25;
        vec3 col = mix(uDeep, uLight, step(0.62, w) * 0.75 + step(0.05, w) * 0.25);
        float wob = sin(a * 24.0 + uTime * 2.2) * 0.04;
        float foam = clamp(step(oct - uIn, 0.16 + wob) + step(uOut - r, 0.14 + wob), 0.0, 1.0);
        col = mix(col, uFoam, foam * 0.9);
        col += uGlow * vec3(0.05, 0.42, 0.40) * (1.0 - smoothstep(0.0, 1.4, oct - uIn));
        gl_FragColor = vec4(col, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.RingGeometry(POOL.water, POOL.rimIn + 0.05, 96, 2), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = PLAZA_Y + 0.32;
  // Jets: droplets travelling along an arc from each spout.
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) seed[i] = Math.random();
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dropMat = new THREE.PointsMaterial({ color: 0xe6f8ff, size: 0.28, map: makeGlowTexture(32), transparent: true, depthWrite: false });
  const droplets = new THREE.Points(dg, dropMat);
  droplets.frustumCulled = false;
  g.add(rim, rimHull, lip, spoutMesh, water, droplets);
  g.traverse(o => { if (o.isMesh || o.isPoints) o.raycast = noRaycast; });
  scene.add(g);
  const u = waterMat.uniforms;
  const pal = {
    deep: [new THREE.Color(0x0f2c46), new THREE.Color(0x3a9bd6)], light: [new THREE.Color(0x1d6a82), new THREE.Color(0x8fe0f0)],
    foam: [new THREE.Color(0x7cc4d2), new THREE.Color(0xf4fcff)], drop: [new THREE.Color(0x9fe6ee), new THREE.Color(0xe6f8ff)],
  };
  fountain = {
    group: g,
    update(t, day) {
      u.uTime.value = t;
      u.uGlow.value = 1 - day;
      u.uDeep.value.copy(pal.deep[0]).lerp(pal.deep[1], day);
      u.uLight.value.copy(pal.light[0]).lerp(pal.light[1], day);
      u.uFoam.value.copy(pal.foam[0]).lerp(pal.foam[1], day);
      dropMat.color.copy(pal.drop[0]).lerp(pal.drop[1], day);
      for (let j = 0; j < JETS; j++) {
        const cx = Math.cos(jetAng(j)), cz = Math.sin(jetAng(j));
        for (let k = 0; k < PER; k++) {
          const i = j * PER + k, f = (t * 0.55 + k / PER + seed[i] * 0.05) % 1;
          const r = 6.75 - f * 2.1 + (seed[i] - 0.5) * 0.14;
          pos[i * 3] = cx * r;
          pos[i * 3 + 1] = PLAZA_Y + 0.72 + Math.sin(f * Math.PI) * 1.5 - f * 0.34;
          pos[i * 3 + 2] = cz * r;
        }
      }
      dg.attributes.position.needsUpdate = true;
    },
  };
}

// People: little cel-shaded townsfolk on the plaza. Walkers on two promenades
// (a couple with dogs on a lead), people resting on the benches and a group
// chatting on the rim. Each body part is one InstancedMesh with per-instance
// colours, so the whole crowd costs about a dozen draw calls.
const SKIN_TONES = [0xf5d0b0, 0xe8b48f, 0xc98d68, 0x8d5a3c, 0xf2c9a0, 0x6b4630];
const SHIRTS = [0xe8665a, 0x5aa7e8, 0x5fcf9a, 0xf2c14e, 0xa889e6, 0x64dedb, 0xf28cb8, 0xf39a4b, 0xf1ede4];
const PANTS = [0x2f3a5a, 0x4a6fa5, 0x6b4f3a, 0x3a3f4a, 0xb59f74];
const HAIR = [0x23201f, 0x5a3a22, 0xe0b458, 0xc0602c, 0xb9b9bd, 0x23201f, 0x5a3a22];
const COATS = [0xc98a4a, 0xf1ede4, 0x3a3230, 0x9a6b40];
const _pm = new THREE.Matrix4(), _pl = new THREE.Matrix4(), _pt = new THREE.Matrix4(), _pr = new THREE.Matrix4(), _pe = new THREE.Euler();

export function buildPedestrians() {
  const rnd = seededRandom(20260911);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const people = [], dogs = [];
  const person = o => ({ skin: pick(SKIN_TONES), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), phase: rnd() * TAU, ...o });
  // Walkers: the inner promenade (pool to contribution track) runs one way,
  // the outer one (track to the rim furniture) the other.
  for (let i = 0; i < 20; i++) {
    const inner = i % 2 === 0, r = inner ? 7.9 + rnd() * 1.6 : 11.95 + rnd() * 0.5, v = 0.7 + rnd() * 0.35;
    people.push(person({ mode: 'walk', r, a: rnd() * TAU, w: (inner ? 1 : -1) * v / r, v, x: 0, z: 0, h: 0 }));
  }
  for (const owner of [people[2], people[7]]) dogs.push({ owner, coat: pick(COATS), phase: rnd() * TAU });
  // People resting on benches, facing the monument.
  const benches = plazaBenchSpots();
  for (const [bi, offsets] of [[0, [-0.36, 0.36]], [3, [0.1]], [5, [-0.2]], [6, [-0.36, 0.36]]]) {
    const { b, x, z } = benches[bi];
    for (const lx of offsets) people.push(person({
      mode: 'sit', y: PLAZA_Y + 0.11, h: Math.atan2(-Math.cos(b), -Math.sin(b)),
      x: x + lx * Math.sin(b) - 0.02 * Math.cos(b), z: z - lx * Math.cos(b) - 0.02 * Math.sin(b),
    }));
  }
  // A little group chatting on the open stretch of rim between a bench and a
  // lantern, with their dog sitting beside them.
  const ga = 1.2, gx = Math.cos(ga) * 14, gz = Math.sin(ga) * 14;
  for (let k = 0; k < 3; k++) {
    const th = 0.5 + k * TAU / 3;
    people.push(person({ mode: 'chat', x: gx + Math.cos(th) * 0.42, z: gz + Math.sin(th) * 0.42, h: Math.atan2(-Math.cos(th), -Math.sin(th)) }));
  }
  dogs.push({ owner: null, x: gx - Math.sin(ga) * 0.85, z: gz + Math.cos(ga) * 0.85, h: Math.atan2(Math.sin(ga), -Math.cos(ga)), coat: pick(COATS), phase: 0 });

  const N = people.length;
  const legGeo = box(0.12, 0.4, 0.14, 0, -0.2, 0);   // pivots at the hip
  const armGeo = box(0.09, 0.34, 0.1, 0, -0.17, 0);  // pivots at the shoulder
  const torsoGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.44, 8).translate(0, 0.62, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.19, 1).translate(0, 1.03, 0);
  const hairGeo = new THREE.SphereGeometry(0.205, 10, 5, 0, TAU, 0, Math.PI * 0.55).rotateX(-0.45).translate(0, 1.04, 0);
  const eyesGeo = mergeParts([box(0.035, 0.055, 0.03, 0.065, 1.02, 0.185), box(0.035, 0.055, 0.03, -0.065, 1.02, 0.185)]);
  const hullGeo = mergeParts([hullOf(torsoGeo, 0.07), hullOf(headGeo, 0.07)]);
  const cloth = toonMat({ color: 0xffffff }); // tinted per instance
  const inst = (geo, mat, count, cast = false) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = cast; m.frustumCulled = false; m.raycast = noRaycast;
    scene.add(m);
    return m;
  };
  const meshes = {
    legL: inst(legGeo, cloth, N, true), legR: inst(legGeo, cloth, N, true), armL: inst(armGeo, cloth, N), armR: inst(armGeo, cloth, N),
    torso: inst(torsoGeo, cloth, N, true), head: inst(headGeo, cloth, N, true), hair: inst(hairGeo, cloth, N),
    eyes: inst(eyesGeo, new THREE.MeshBasicMaterial({ color: 0x1a1d26 }), N), hull: inst(hullGeo, getOutlineMat(), N),
  };
  const col = new THREE.Color();
  people.forEach((p, i) => {
    for (const k of ['legL', 'legR']) meshes[k].setColorAt(i, col.setHex(p.pants));
    for (const k of ['armL', 'armR', 'torso']) meshes[k].setColorAt(i, col.setHex(p.shirt));
    meshes.head.setColorAt(i, col.setHex(p.skin));
    meshes.hair.setColorAt(i, col.setHex(p.hair));
  });

  // Dogs: one merged, vertex-coloured model tinted per instance by its coat.
  const dogBody = box(0.2, 0.18, 0.42, 0, 0.25, 0), dogHead = box(0.19, 0.18, 0.19, 0, 0.4, 0.25);
  const dogHull = mergeParts([hullOf(dogBody, 0.07), hullOf(dogHead, 0.07)]);
  const dogParts = [[dogBody, 0xffffff], [dogHead, 0xffffff],
    [box(0.1, 0.08, 0.1, 0, 0.36, 0.38), 0xd8d0c4],                                     // snout
    [box(0.05, 0.04, 0.03, 0, 0.39, 0.435), 0x1a1d26],                                   // nose
    [box(0.05, 0.1, 0.07, 0.075, 0.5, 0.22), 0x8a7a6a], [box(0.05, 0.1, 0.07, -0.075, 0.5, 0.22), 0x8a7a6a], // ears
    [box(0.03, 0.04, 0.02, 0.05, 0.44, 0.345), 0x1a1d26], [box(0.03, 0.04, 0.02, -0.05, 0.44, 0.345), 0x1a1d26], // eyes
    [box(0.045, 0.045, 0.2).rotateX(0.7).translate(0, 0.36, -0.28), 0xffffff],          // tail up
  ];
  for (const lx of [-0.07, 0.07]) for (const lz of [-0.14, 0.14]) dogParts.push([box(0.06, 0.17, 0.06, lx, 0.085, lz), 0xffffff]);
  const dogMesh = inst(mergeParts(dogParts, true), toonMat({ vertexColors: true }), dogs.length, true);
  const dogInk = inst(dogHull, getOutlineMat(), dogs.length);
  dogs.forEach((d, i) => dogMesh.setColorAt(i, col.setHex(d.coat)));
  // Leads, one segment per dog (a loose dog's stays collapsed).
  const leashGeo = new THREE.BufferGeometry();
  leashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dogs.length * 6), 3));
  const leash = new THREE.LineSegments(leashGeo, new THREE.LineBasicMaterial({ color: 0x2a2320 }));
  leash.frustumCulled = false; leash.raycast = noRaycast;
  scene.add(leash);
  pedestrians = { people, dogs, meshes, dogMesh, dogInk, leash };
}

export function disposePerson(person) {
  if (!person) return;
  scene.remove(person.group);
  disposeObject(person.group);
}

// A pocket unicorn: oversized head, stubby hooves and a candy-coloured mane.
// The character faces -Z, matching the walk controller's forward direction.
export function buildPerson() {
  const group = new THREE.Group(); group.name = 'walk-unicorn';
  const coat = toonMat({ color: 0xfff1e9 });
  const pink = toonMat({ color: 0xf9a7c8 });
  const hoof = toonMat({ color: 0x8272bd });
  const gold = toonMat({ color: 0xffcd65 });
  const rainbow = [0xed83b5, 0xad8ee3, 0x78cfd0, 0xffd780].map(color => toonMat({ color }));
  const white = new THREE.MeshBasicMaterial({ color: 0xfffcf5 });
  const ink = new THREE.MeshBasicMaterial({ color: 0x282237 });
  const mesh = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true; m.raycast = noRaycast;
    parent.add(m); return m;
  };
  const oval = (parent, mat, x, y, z, sx, sy, sz) => {
    const geo = new THREE.SphereGeometry(1, 12, 8); geo.scale(sx, sy, sz);
    return mesh(parent, geo, mat, x, y, z);
  };
  const body = new THREE.Group(); group.add(body);
  oval(body, coat, 0, .61, .045, .32, .31, .47);
  oval(body, coat, 0, .84, -.28, .23, .34, .24);
  const head = new THREE.Group(); head.position.set(0, 1.12, -.35); body.add(head);
  oval(head, coat, 0, 0, 0, .30, .29, .31);
  oval(head, pink, 0, -.11, -.27, .255, .16, .23);
  for (const side of [-1, 1]) {
    oval(head, ink, side * .105, -.065, -.471, .026, .019, .012);
    oval(head, white, side * .205, .045, -.205, .102, .12, .069);
    oval(head, ink, side * .21, .035, -.265, .044, .065, .022);
    oval(head, white, side * .21 - .012, .061, -.285, .013, .020, .009);
    const ear = oval(head, coat, side * .20, .30, .02, .075, .17, .065);
    ear.rotation.z = -side * .23;
    oval(head, pink, side * .205, .32, -.037, .036, .103, .013);
  }
  const horn = mesh(head, new THREE.ConeGeometry(.085, .43, 10), gold, 0, .39, -.13);
  horn.rotation.x = -.18;
  // Thin lilac bands give the horn a candy twist without a texture asset.
  for (let i = 0; i < 3; i++) {
    const band = mesh(head, new THREE.TorusGeometry(.068 - i * .018, .009, 4, 10), rainbow[1], 0, .28 + i * .09, -.11 - i * .016);
    band.rotation.x = Math.PI / 2 - .18;
  }
  // Scalloped locks down the back remain visible from the normal chase camera.
  for (let i = 0; i < 6; i++) {
    oval(head, rainbow[i % 4], Math.sin(i * .8) * .035, .24 - i * .09, .12 + i * .034, .105, .12, .12);
  }
  oval(head, rainbow[0], -.085, .22, -.13, .12, .085, .18).rotation.z = -.3;
  const tail = new THREE.Group(); tail.position.set(0, .71, .43); body.add(tail);
  for (let i = 0; i < 4; i++) {
    const lock = oval(tail, rainbow[i], (i - 1.5) * .046, -.07 - i * .035, .13, .063, .24, .11);
    lock.rotation.x = -.55; lock.rotation.z = (i - 1.5) * .15;
  }
  const wing = side => {
    const pivot = new THREE.Group(); pivot.name = side > 0 ? 'wing-left' : 'wing-right';
    pivot.position.set(side * .25, .81, .02); body.add(pivot);
    oval(pivot, coat, side * .25, 0, .025, .33, .075, .24);
    for (let i = 0; i < 5; i++) {
      const feather = oval(pivot, i % 2 ? coat : rainbow[1], side * (.39 + i * .075), -.012, -.15 + i * .085,
        .28 - i * .025, .045, .075);
      feather.rotation.y = -side * (.12 + i * .12);
    }
    pivot.rotation.z = side * 1.18;
    return pivot;
  };
  const wingL = wing(1), wingR = wing(-1);
  const leg = (x, z) => {
    const pivot = new THREE.Group(); pivot.position.set(x, .42, z); body.add(pivot);
    oval(pivot, coat, 0, -.15, 0, .085, .18, .09);
    oval(pivot, hoof, 0, -.34, -.018, .11, .08, .125);
    return pivot;
  };
  const legL = leg(.21, .30), legR = leg(-.21, .30);
  const armL = leg(.21, -.28), armR = leg(-.21, -.28);
  group.visible = false; scene.add(group);
  return { group, parts: { body, head, tail, legL, legR, armL, armR, wingL, wingR }, phase: 0, age: 0 };
}

export function posePerson(person, { speed = 0, dt = 0, airborne = false, flying = false } = {}) {
  if (!person) return 0;
  const { body, head, tail, legL, legR, armL, armR, wingL, wingR } = person.parts;
  person.age += dt; person.phase += speed * 2.8 * dt;
  const wingAngle = airborne ? (flying ? Math.sin(person.age * 15) * .65 : .12 + Math.sin(person.age * 4) * .12) : 1.18;
  const wingBlend = 1 - Math.exp(-dt * 12);
  wingL.rotation.z += (wingAngle - wingL.rotation.z) * wingBlend;
  wingR.rotation.z += (-wingAngle - wingR.rotation.z) * wingBlend;
  const moving = speed > .15, swing = moving ? Math.sin(person.phase) : 0;
  body.rotation.z = airborne ? 0 : swing * .045;
  head.rotation.z = -body.rotation.z * .5 + Math.sin(person.age * 1.7) * .035;
  head.rotation.x = moving ? Math.cos(person.phase * 2) * .055 : Math.sin(person.age * 2) * .025;
  tail.rotation.z = Math.sin(person.age * 3 + swing * .5) * .22;
  // Opposite diagonal pairs make a buoyant pony trot; tuck all four in a jump.
  legL.rotation.x = airborne ? .65 : swing * .55;
  legR.rotation.x = airborne ? .5 : -swing * .55;
  armL.rotation.x = airborne ? -1 : -swing * .55;
  armR.rotation.x = airborne ? -.85 : swing * .55;
  return airborne ? 0 : moving ? Math.abs(Math.sin(person.phase)) * .065 : Math.sin(person.age * 2) * .006;
}

// Weather: rain (streaking points) or snow (soft points). Toggleable.
export function buildWeather() {
  const N = 900;
  const pos = new Float32Array(N * 3);
  const data = [];
  for (let i = 0; i < N; i++) {
    const x = (Math.random() - 0.5) * 120, y = Math.random() * 60, z = (Math.random() - 0.5) * 120;
    pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z;
    data.push({ y, speed: 25 + Math.random()*15, drift: Math.random()*2 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0x9fc0ff, size: 0.12, transparent: true, opacity: 0.7 });
  const snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.9 });
  const points = new THREE.Points(geo, rainMat);
  points.visible = false;
  scene.add(points);
  weather = { points, geo, data, rainMat, snowMat, N };
}

export function setWeather(mode, btn) {
  weatherMode = mode;
  if (weather) {
    weather.points.visible = mode !== 'clear';
    weather.points.material = mode === 'rain' ? weather.rainMat : weather.snowMat;
    weather.points.scale.y = mode === 'rain' ? 4 : 1;
  }
  if (btn) {
    btn.textContent = mode === 'clear' ? 'Clear' : mode === 'rain' ? 'Rain' : 'Snow';
    btn.classList.toggle('on', mode !== 'clear');
  }
}

export function updateFountain(day) { // day: 0 night .. 1 noon (app.js dayFactor)
  if (fountain?.update) fountain.update(clock.getElapsed(), day);
}
export function updatePedestrians(dt) {
  if (!pedestrians?.people) return;
  const { people, dogs, meshes, dogMesh, dogInk, leash } = pedestrians, t = clock.getElapsed();
  const limb = (mesh, i, x, y, ax, az) => {
    _pl.copy(_pm).multiply(_pt.makeTranslation(x, y, 0)).multiply(_pr.makeRotationFromEuler(_pe.set(ax, 0, az, 'ZYX')));
    mesh.setMatrixAt(i, _pl);
  };
  people.forEach((p, i) => {
    let y = PLAZA_Y, h = p.h, swing = 0, leg = 0, arm = 0, wave = 0;
    if (p.mode === 'walk') {
      p.a += p.w * dt;
      p.phase += p.v * 8 * dt;
      p.x = Math.cos(p.a) * p.r; p.z = Math.sin(p.a) * p.r;
      h = p.h = p.w > 0 ? -p.a : Math.PI - p.a;
      swing = Math.sin(p.phase);
      y += Math.abs(Math.cos(p.phase)) * 0.045; // step bob
    } else if (p.mode === 'sit') {
      y = p.y; leg = -1.35; arm = -0.3;
      swing = Math.sin(t * 1.4 + p.phase) * 0.12; // idly swinging feet
    } else {
      // Chatting: a gentle sway, and every so often an arm goes up mid-story.
      h += Math.sin(t * 0.6 + p.phase) * 0.12;
      y += Math.max(0, Math.sin(t * 2.2 + p.phase)) * 0.02;
      wave = -1.9 * Math.pow(Math.max(0, Math.sin(t * 0.9 + p.phase * 2)), 4);
    }
    _pm.makeRotationY(h).setPosition(p.x, y, p.z);
    for (const k of ['torso', 'head', 'hair', 'eyes', 'hull']) meshes[k].setMatrixAt(i, _pm);
    const legSwing = p.mode === 'walk' ? swing * 0.55 : swing;
    limb(meshes.legL, i, 0.075, 0.4, leg + legSwing, 0);
    limb(meshes.legR, i, -0.075, 0.4, leg - legSwing, 0);
    limb(meshes.armL, i, 0.22, 0.8, arm - swing * 0.5, 0.12);
    limb(meshes.armR, i, -0.22, 0.8, arm + swing * 0.5 + wave, -0.12);
  });
  for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
  const lp = leash.geometry.attributes.position.array;
  dogs.forEach((d, i) => {
    const o = d.owner;
    let x = d.x, z = d.z, h = d.h, y = PLAZA_Y;
    if (o) {
      // Trots a step behind its owner, on the open side of the promenade.
      const side = o.w > 0 ? 0.45 : -0.45, a = o.a - Math.sign(o.w) * 0.8 / o.r;
      x = Math.cos(a) * (o.r + side); z = Math.sin(a) * (o.r + side); h = o.h;
      y += Math.abs(Math.sin(o.phase * 1.3 + d.phase)) * 0.06;
      // Lead from the owner's hand on that side to the collar.
      const hs = Math.sign(side) * 0.26;
      lp.set([o.x + Math.cos(o.a) * hs, PLAZA_Y + 0.5, o.z + Math.sin(o.a) * hs,
        x + Math.sin(h) * 0.22, y + 0.34, z + Math.cos(h) * 0.22], i * 6);
    } else {
      h += Math.sin(t * 3) * 0.08;
      y += Math.abs(Math.sin(t * 5)) * 0.015;
    }
    _pm.makeRotationY(h).setPosition(x, y, z);
    dogMesh.setMatrixAt(i, _pm);
    dogInk.setMatrixAt(i, _pm);
  });
  dogMesh.instanceMatrix.needsUpdate = dogInk.instanceMatrix.needsUpdate = true;
  leash.geometry.attributes.position.needsUpdate = true;
}
export function updateWeather(dt) {
  if (!weather || weatherMode === 'clear') return; // setWeather() sets the mode
  const { points, geo, data, N } = weather;
  const pos = geo.attributes.position.array;
  const rain = weatherMode === 'rain';
  const fall = rain ? 1 : 0.18, sway = rain ? 2 : 3.5; // snow drifts down slowly and sways more
  const t = clock.getElapsed();
  for (let i = 0; i < N; i++) {
    data[i].y -= data[i].speed * fall * dt;
    if (data[i].y < 0) data[i].y = 60;
    pos[i*3+1] = data[i].y;
    pos[i*3] += Math.sin(t + data[i].drift) * dt * sway;
  }
  geo.attributes.position.needsUpdate = true;
  // stretch rain into streaks via scale (cheap fake)
  points.scale.y = rain ? 4 : 1;
}
