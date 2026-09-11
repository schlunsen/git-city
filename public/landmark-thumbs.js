/*
 * Gitilla — little rendered pictures of the 3D landmarks, for the Customize
 * panel's landmark picker.
 *
 * Each attraction (attractions.js) is built once in a small offscreen scene,
 * rendered to a PNG data URL and cached for the visit; the renderer is thrown
 * away afterwards. New landmarks get a picture automatically. Nothing here is
 * fetched: the pictures are drawn from the same code that builds the island.
 */

const cache = new Map(); // attraction key -> data URL
let running = null;

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function dispose(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) m.dispose?.();
  });
}

/**
 * Calls onThumb(key, dataUrl) for every landmark: at once for pictures already
 * made, the rest one by one as they render (yielding between builds, so the
 * page stays responsive). Resolves when all are done.
 */
export function renderLandmarkThumbs(onThumb, { width = 208, height = 156 } = {}) {
  for (const [k, url] of cache) onThumb(k, url);
  running = (running || Promise.resolve()).then(() => draw(onThumb, width, height)).catch((err) => {
    console.warn('[git-city] landmark pictures unavailable', err);
  });
  return running;
}

async function draw(onThumb, width, height) {
  const THREE = await import('three');
  const { ATTRACTIONS } = await import('./attractions.js');
  const todo = ATTRACTIONS.filter((a) => !cache.has(a.key));
  if (!todo.length) return;

  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // The island's toon look: the same 4-band ramp and ink as city/toon.js, in daylight.
  const ramp = new THREE.DataTexture(new Uint8Array([98, 98, 98, 255, 152, 152, 152, 255, 218, 218, 218, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  const envMat = (night, day, extra = {}) => new THREE.MeshToonMaterial({ color: day, gradientMap: ramp, ...extra });
  const ink = new THREE.MeshBasicMaterial({ color: 0x0a0d16, side: THREE.BackSide });

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x5f9a58, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(40, 90, 30);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), envMat(0x1e3326, 0x7cc55a));
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(36, width / height, 0.5, 2000);
  const box = new THREE.Box3(), size = new THREE.Vector3(), centre = new THREE.Vector3();
  const az = THREE.MathUtils.degToRad(35), el = THREE.MathUtils.degToRad(22);

  for (const a of todo) {
    let obj = null;
    try {
      obj = a.build({ THREE, envMat, ink, rnd: mulberry32(hash(a.key)) }, {});
      obj.update?.(0, 1.5); // a pose, not frame zero
      scene.add(obj.group);
      box.setFromObject(obj.group);
      box.getSize(size);
      box.getCenter(centre);
      ground.scale.setScalar(Math.max(size.x, size.z) * 0.62 + 1);
      // Fit the bounding sphere in the (vertical) field of view.
      const radius = size.length() / 2;
      const d = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.92;
      camera.position.set(centre.x + Math.sin(az) * Math.cos(el) * d, centre.y + Math.sin(el) * d, centre.z + Math.cos(az) * Math.cos(el) * d);
      camera.lookAt(centre);
      renderer.render(scene, camera);
      const url = canvas.toDataURL('image/png');
      cache.set(a.key, url);
      onThumb(a.key, url);
    } catch (err) {
      console.warn('[git-city] no picture for', a.key, err);
    } finally {
      if (obj) { scene.remove(obj.group); dispose(obj.group); }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  dispose(scene);
  ramp.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
}
