/*
 * The renderer, scene, camera, orbit controls and lights, plus the world.js
 * island. Other modules import these bindings (live, read-only); only this
 * module assigns them.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { buildSky } from '../city-enhancements.js';
import { createWorld } from '../world.js';
import { envMat, seededRandom } from './toon.js';
import { DISTRICT, CELL, SLAB_HALF, SLAB_R, STREET_W } from './layout.js';

export let scene, camera, renderer, controls, clock;
export let sun, moon, hemi, cityGroup, carGroup;
export let raycaster, pointerNDC;
export let skyDome = null; // buildSky() handle (gradient dome + stars + sun/moon)
export let world = null;   // createWorld() handle: island, hills, cutouts, clouds, decals

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
export function initScene(hooks = {}) { // hooks: onControlStart / onControlEnd (app.js: tour pause, idle orbit)
  const canvas = document.getElementById('scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Phones: cap the pixel ratio (and the shadow map below) — the toon look doesn't need retina fill.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed from three.js
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b111a, 260, 900);

  // Gradient sky dome (custom GLSL) replaces the flat background color. The
  // dome owns the sky color + stars + sun/moon, so we keep scene.background
  // null and let the shader handle it.
  skyDome = buildSky(THREE, scene);

  // Far plane must reach the sky dome (r=1000) from the far side of the orbit
  // (maxDistance 360), or a black hole opens straight ahead when zoomed out.
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 2600);
  camera.position.set(58, 46, 62);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.minDistance = 24;
  controls.maxDistance = 360;
  controls.maxPolarAngle = Math.PI * 0.49; // don't go below the ground
  controls.target.set(0, 8, 0);

  // Dragging hands the camera to the user: app.js pauses the tour and the idle auto-rotate.
  controls.addEventListener('start', () => hooks.onControlStart?.());
  controls.addEventListener('end', () => hooks.onControlEnd?.());

  clock = new THREE.Timer(); // advanced once per frame in animate()
  raycaster = new THREE.Raycaster();
  pointerNDC = new THREE.Vector2();

  // ---- Lights -------------------------------------------------------------
  hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a1410, 0.5);
  scene.add(hemi);

  // r186 SunLight: a directional sun with two cascaded shadow maps fitted to
  // the view, so shadows reach across the whole island (the old
  // DirectionalLight had a fixed 140-unit box around the city). No target:
  // it shines from its position toward the origin.
  sun = new SunLight(0xfff1d6, 1.3);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048); // per cascade
  sun.shadow.camera.far = coarse ? 260 : 420; // max shadow distance from the camera
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 2.5; // PCF blur keeps the soft shadow edges
  scene.add(sun);

  moon = new THREE.DirectionalLight(0x8aa2ff, 0.25);
  moon.position.set(-50, 70, -30);
  scene.add(moon);

  cityGroup = new THREE.Group();
  scene.add(cityGroup);
  carGroup = new THREE.Group();
  scene.add(carGroup);
}

// The island (world.js): built once, re-dressed per profile by world.setProfile().
export function initWorld() {
  world = createWorld(THREE, scene, { envMat, seededRandom, DISTRICT, CELL, slabHalf: SLAB_HALF, slabRadius: SLAB_R, streetW: STREET_W });
  return world;
}
