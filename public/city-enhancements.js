/*
 * Git City — visual enhancement modules
 * Self-contained, hand-written GLSL where sensible (no postprocessing libs).
 * Each builder is additive: it takes the existing scene/graphs and returns
 * a small object with an optional .update(dt, elapsed) hook. Drop-ins for
 * public/app.js — call each after the base city is built.
 *
 * THREE is passed in by the host (which loads it via its import map), so these
 * modules work in any module context without a bare "three" specifier.
 */

/* ==========================================================================
 * 1. CONTRIBUTION-HEATMAP RING
 * 365 days of green voxel bricks rising from the ground around the plaza.
 * ========================================================================== */

// Fetch the profile's public events (up to 300 over 90 days). Failure-tolerant:
// any error yields [] so the city still renders without an activity timeline.
export async function fetchEvents(login, { perPage = 100, pages = 3, org = false } = {}) { // org: an organization's public events
  const events = [];
  try {
    for (let page = 1; page <= pages; page++) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(
        org ? `https://api.github.com/orgs/${encodeURIComponent(login)}/events?per_page=${perPage}&page=${page}`
          : `https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=${perPage}&page=${page}`,
        { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal }
      );
      clearTimeout(to);
      if (!res.ok) break;
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      events.push(...batch);
      if (batch.length < perPage) break;
    }
  } catch {
    /* keep what we have */
  }
  return events;
}

// Per-day contribution counts, index 0 = today (the ring reads clockwise back in time).
export function contributionDays(events, days = 90) {
  const hist = new Array(days).fill(0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const e of events) {
    const d = new Date(e.created_at);
    if (Number.isNaN(d.getTime())) continue;
    d.setUTCHours(0, 0, 0, 0);
    const idx = Math.round((today - d) / 86400000);
    if (idx >= 0 && idx < days) hist[idx] += 1;
  }
  return hist;
}

export async function fetchContributionDays(login, days = 90) {
  return contributionDays(await fetchEvents(login, { pages: 1 }), days);
}

// Build a ring of voxel bricks around the plaza. Intensity (height + color)
// tracks the per-day contribution count. Uses ONE InstancedMesh for all bricks
// so 365 bricks cost a single draw call.
export function buildHeatmapRing(THREE, scene, hist, { radius = 14, brick = 1.1 } = {}) {
  const n = hist.length;
  const max = Math.max(1, ...hist);
  const geo = new THREE.BoxGeometry(brick * 0.82, 1, brick * 0.82);
  geo.translate(0, 0.5, 0); // pivot at the base so scale.y grows upward
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x64dedb, emissiveIntensity: 0.25, roughness: 0.6 });
  const inst = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  // GitHub contribution green scale: dim -> bright green
  const lo = new THREE.Color(0x0c2426), hi = new THREE.Color(0x64dedb);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pos.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    const t = hist[i] / max;
    const h = 0.4 + t * 3.2; // brick height
    scl.set(1, h, 1);
    m4.compose(pos, q, scl);
    inst.setMatrixAt(i, m4);
    col.copy(lo).lerp(hi, t);
    inst.setColorAt(i, col);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);
  return { mesh: inst, hist };
}

export async function attachHeatmapRing(THREE, scene, login, opts = {}) {
  const hist = await fetchContributionDays(login, opts.days || 90);
  return buildHeatmapRing(THREE, scene, hist, opts);
}

/* ==========================================================================
 * 2. HAND-WRITTEN POST PASS  (bloom + color grade + vignette + grain)
 * A single fullscreen shader pass. We render the scene to a render target,
 * then composite to screen with cheap multi-tap bloom, a day/night grade,
 * a vignette, and animated film grain. No EffectComposer / UnrealBloom.
 * ========================================================================== */
const POST_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // full-screen triangle
  }
`;
const POST_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tScene;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uDay;        // 0=night, 1=day
  uniform float uBloom;      // 0..1 strength
  varying vec2  vUv;

  // ---- cheap 8-tap directional bloom (no downsample pass) ----
  float sampleLuma(vec2 uv, vec2 dir, float px) {
    vec3 c = texture2D(tScene, uv + dir * px / uResolution).rgb;
    return dot(c, vec3(0.299, 0.587, 0.114));
  }
  vec3 bloom(vec2 uv, float px) {
    vec3 sum = vec3(0.0);
    float w = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981; // 2*pi/8
      vec2 dir = vec2(cos(a), sin(a));
      float l = sampleLuma(uv, dir, px);
      float b = max(l - 0.9, 0.0);   // threshold
      sum += texture2D(tScene, uv + dir * px / uResolution).rgb * b;
      w += b;
    }
    return sum / 8.0;
  }

  // ---- simple hash noise for grain ----
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 col = texture2D(tScene, vUv).rgb;

    // bloom: two tap radii (in pixels) for a softer halo
    vec3 bl = bloom(vUv, 2.0) * 0.7 + bloom(vUv, 5.0) * 0.5;
    col += bl * uBloom;

    // ---- day/night color grade ----
    // Day: teal shadows -> warm orange highlights.
    // Night: cool blue lift in shadows, slight magenta in mids.
    vec3 dayGrade  = col * vec3(1.04, 1.00, 0.94);
    dayGrade.b *= 0.97;                       // pull a touch of blue out of day mids
    dayGrade.r += col.g * 0.03;               // warm it
    vec3 nightGrade = col * vec3(0.86, 0.92, 1.12); // blue lift
    nightGrade.b += col.r * 0.02;
    col = mix(nightGrade, dayGrade, uDay);

    // ---- cartoon punch: cel-shaded flats want a touch more chroma by day ----
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, 1.0 + 0.22 * uDay);

    // ---- vignette ----
    vec2 d = vUv - 0.5;
    float vig = (1.0 - smoothstep(0.35, 0.95, length(d) * 1.35));
    col *= mix(0.72, 1.0, vig);

    // ---- film grain (subtle, animated) ----
    float g = hash(vUv * uResolution + uTime) - 0.5;
    col += g * 0.006;

    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createPostPass(THREE, renderer, scene, camera, { bloom = 0.6 } = {}) {
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    samples: Math.min(4, renderer.capabilities.maxSamples),
  });
  const mat = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader: POST_FRAG,
    uniforms: {
      tScene: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDay: { value: 1 },
      uBloom: { value: bloom },
    },
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.Camera();
  quadScene.add(quad);

  function resize(w, h) {
    const pr = Math.min(window.devicePixelRatio, 2);
    rt.setSize(Math.floor(w * pr), Math.floor(h * pr));
    mat.uniforms.uResolution.value.set(rt.width, rt.height);
  }
  resize(window.innerWidth, window.innerHeight);

  function render(time, day) {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    mat.uniforms.tScene.value = rt.texture;
    mat.uniforms.uTime.value = time;
    mat.uniforms.uDay.value = day;
    renderer.render(quadScene, quadCam);
  }
  function dispose() {
    rt.dispose();
    mat.dispose();
    quad.geometry.dispose();
  }
  return { render, resize, dispose, setBloom: (v) => (mat.uniforms.uBloom.value = v) };
}

/* ==========================================================================
 * 3. GRADIENT SKY DOME + STARS + SUN/MOON  (custom GLSL)
 * ========================================================================== */
const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
  }
`;
const SKY_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uTop;      // zenith color
  uniform vec3 uHorizon;  // horizon color
  uniform float uDay;     // 0=night,1=day
  uniform float uTime;
  varying vec3 vDir;
  // Three slow, offset nebula clouds (the same hues as Gource View's backdrop)
  // read as depth without ever becoming an opaque blob.
  vec3 nebula(vec3 d, float t) {
    vec3 c0 = vec3(36.0, 92.0, 148.0) / 255.0;
    vec3 c1 = vec3(78.0, 46.0, 138.0) / 255.0;
    vec3 c2 = vec3(22.0, 104.0, 106.0) / 255.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float a = t * 0.02 + fi * 2.1;
      vec3 center = normalize(vec3(cos(a), 0.28 + 0.12 * fi + 0.06 * sin(t * 0.05 + fi), sin(a * 0.77 + fi)));
      float k = max(0.0, dot(d, center));
      float w = pow(k, 5.0 + fi * 2.5) * 0.42;
      acc += (i == 0 ? c0 : (i == 1 ? c1 : c2)) * w;
    }
    return acc;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    // smooth vertical gradient, brighter near horizon
    float t = pow(1.0 - h, 1.6);
    // Cel-shaded sky: snap the gradient into a handful of flat bands.
    t = mix(t, floor(t * 5.0 + 0.5) / 5.0, 0.7);
    vec3 col = mix(uTop, uHorizon, t);
    col += nebula(d, uTime) * (1.0 - uDay * 0.85);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function celestialTexture(THREE, kind, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  ctx.lineJoin = 'round';
  if (kind === 'sun') {
    // Twelve stubby rays behind a warm disc, all with the same ink outline.
    ctx.fillStyle = '#ffc93a'; ctx.strokeStyle = '#1a2233'; ctx.lineWidth = 9;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - 0.14) * 80, cy + Math.sin(a - 0.14) * 80);
      ctx.lineTo(cx + Math.cos(a) * 118, cy + Math.sin(a) * 118);
      ctx.lineTo(cx + Math.cos(a + 0.14) * 80, cy + Math.sin(a + 0.14) * 80);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#ffe36b';
    ctx.beginPath(); ctx.arc(cx, cy, 82, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath(); ctx.arc(cx - 22, cy - 22, 30, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = '#eef2ff'; ctx.strokeStyle = '#1a2233'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(cx, cy, 96, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c9d2ee';
    for (const [x, y, r] of [[-30, -20, 22], [28, 10, 16], [-6, 44, 12]]) {
      ctx.beginPath(); ctx.arc(cx + x, cy + y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSky(THREE, scene) {
  const topDay = new THREE.Color(0x3d8fe0), horDay = new THREE.Color(0xd9eefa);
  const topNight = new THREE.Color(0x070b16), horNight = new THREE.Color(0x141f36);
  const uniforms = {
    uTop: { value: topDay.clone() },
    uHorizon: { value: horDay.clone() },
    uDay: { value: 1 },
    uTime: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  scene.add(sky);

  // stars
  const N = 1500;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    // random points on a large sphere shell
    const v = new THREE.Vector3().randomDirection().multiplyScalar(900);
    if (v.y < 10) v.y = Math.abs(v.y) + 10; // keep them above horizon
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0,
    depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // sun + moon: flat inked discs drawn on canvases (cartoon, not photoreal)
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: celestialTexture(THREE, 'sun'), transparent: true, depthWrite: false, fog: false }));
  sun.scale.set(46, 46, 1);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: celestialTexture(THREE, 'moon'), transparent: true, depthWrite: false, fog: false }));
  moon.scale.set(30, 30, 1);
  scene.add(sun, moon);

  function setDay(day) {
    const d = THREE.MathUtils.clamp(day, 0, 1);
    uniforms.uTop.value.copy(topNight).lerp(topDay, d);
    uniforms.uHorizon.value.copy(horNight).lerp(horDay, d);
    uniforms.uDay.value = d;
    starMat.opacity = (1 - d) * 0.9;
    sun.visible = d > 0.1;
    moon.visible = d < 0.5;
    // orbit sun/moon opposite arcs
    const a = d * Math.PI; // 0..pi across the sky
    sun.position.set(Math.cos(a) * 300, Math.sin(a) * 220 + 20, -120);
    moon.position.set(-Math.cos(a) * 300, Math.sin(a) * 220 + 20, -120);
  }
  setDay(1);
  return { sky, stars, sun, moon, setDay, setTime: (t) => { uniforms.uTime.value = t; } };
}

/* ==========================================================================
 * 4. DRIFTING DUST  (Gource View's slow motes, in 3D)
 * One Points object; positions wrap inside a box around the city.
 * ========================================================================== */
export function buildDust(THREE, scene, { count = 420, extent = 150, height = 70 } = {}) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * extent;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * extent;
    vel[i * 3] = (Math.random() - 0.5) * 0.8;
    vel[i * 3 + 1] = 0.15 + Math.random() * 0.35;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.PointsMaterial({
    map: tex, color: 0xaad2f0, size: 0.9, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  function update(dt, elapsed) {
    const p = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      p[i * 3] += (vel[i * 3] + Math.sin(elapsed * 0.3 + i) * 0.2) * dt;
      p[i * 3 + 1] += vel[i * 3 + 1] * dt;
      p[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (p[i * 3 + 1] > height) p[i * 3 + 1] = 0;
      if (p[i * 3] > extent / 2) p[i * 3] = -extent / 2; else if (p[i * 3] < -extent / 2) p[i * 3] = extent / 2;
      if (p[i * 3 + 2] > extent / 2) p[i * 3 + 2] = -extent / 2; else if (p[i * 3 + 2] < -extent / 2) p[i * 3 + 2] = extent / 2;
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { points, mat, update, setNight: (n) => { mat.opacity = 0.08 + n * 0.3; } };
}


/* ==========================================================================
 * 5. OLD-TELEVISION PASS  (lo-fi on purpose)
 * Renders the scene without MSAA at up to 1.5x device pixels, then composites
 * with barrel curvature, light RGB fringing, fixed 3px scanlines, a soft
 * aperture mask, a slow rolling bar, grain and a vignette. No bloom — far
 * cheaper than the FX pass, and sharp enough to read the city.
 * ========================================================================== */
const CRT_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tScene;
  uniform float uLines;      // scanline count (one per ~3 CSS pixels)
  uniform float uTime;
  uniform float uMotion;     // 0 when the viewer prefers reduced motion
  varying vec2  vUv;

  vec2 curve(vec2 uv) {
    uv = uv * 2.0 - 1.0;
    vec2 off = abs(uv.yx) / vec2(5.5, 4.5);
    uv += uv * off * off;
    return uv * 0.5 + 0.5;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 uv = curve(vUv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    // RGB fringing that breathes a little, stronger toward the edges.
    float edge = length(vUv - 0.5);
    float ab = (0.0004 + 0.0010 * edge) * (1.0 + 0.3 * sin(uTime * 0.9) * uMotion);
    // A faint horizontal jitter line now and then, like a tired tube.
    float jitter = uMotion * step(0.995, hash(vec2(floor(uTime * 12.0), 3.0))) * 0.004 * sin(uv.y * 90.0 + uTime * 40.0);
    vec2 j = vec2(jitter, 0.0);
    vec3 col;
    col.r = texture2D(tScene, uv + j + vec2(ab, 0.0)).r;
    col.g = texture2D(tScene, uv + j).g;
    col.b = texture2D(tScene, uv + j - vec2(ab, 0.0)).b;

    // Scanlines on the low-res rows, and a phosphor aperture mask on screen pixels.
    float scan = 0.8 + 0.2 * abs(sin(uv.y * uLines * 3.14159265));
    float m = mod(gl_FragCoord.x, 3.0);
    vec3 mask = vec3(m < 1.0 ? 1.0 : 0.9, (m >= 1.0 && m < 2.0) ? 1.0 : 0.9, m >= 2.0 ? 1.0 : 0.9);
    col *= scan * mask * 1.14;

    // Slow rolling bright bar + mains flicker + grain.
    col *= 1.0 + 0.05 * uMotion * smoothstep(0.0, 0.08, 0.08 - abs(fract(uv.y * 0.6 - uTime * 0.07) - 0.5));
    col *= 1.0 - 0.02 * uMotion * sin(uTime * 55.0);
    col += (hash(gl_FragCoord.xy + floor(uTime * 24.0)) - 0.5) * 0.035;

    // Warm the whites a touch, lift the blacks like an old tube, and vignette hard.
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.12) * vec3(1.03, 1.0, 0.95) + 0.015;
    vec2 v = uv * (1.0 - uv.yx);
    col *= pow(v.x * v.y * 22.0, 0.28);

    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCrtPass(THREE, renderer, scene, camera, { scale = Math.min(window.devicePixelRatio || 1, 1.5), motion = true } = {}) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  const mat = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader: CRT_FRAG,
    uniforms: {
      tScene: { value: rt.texture },
      uLines: { value: 300 },
      uTime: { value: 0 },
      uMotion: { value: motion ? 1 : 0 },
    },
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.Camera();
  quadScene.add(quad);
  function resize(w, h) {
    rt.setSize(Math.max(160, Math.floor(w * scale)), Math.max(100, Math.floor(h * scale)));
    mat.uniforms.uLines.value = Math.max(80, Math.floor(h / 3)); // fixed ~3px pitch at any resolution
  }
  resize(window.innerWidth, window.innerHeight);
  function render(time) {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    mat.uniforms.uTime.value = time;
    renderer.render(quadScene, quadCam);
  }
  return { render, resize, dispose: () => { rt.dispose(); mat.dispose(); quad.geometry.dispose(); } };
}
