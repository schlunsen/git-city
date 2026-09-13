// ---------------------------------------------------------------------------
// explore-style.js — explore.js's injected CSS (mode HUD, menu, touch controls;
// travel warp card and toast) and the full-screen travel-warp fragment shader.
// ---------------------------------------------------------------------------

// Styles live with the module so index.html only needs the Explore button.
export function injectStyle() {
  if (document.getElementById('gcx-style')) return;
  const s = document.createElement('style');
  s.id = 'gcx-style';
  s.textContent = `
  .gcx-hud { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--transport-h, 96px) + 14px); z-index: 30;
    display: flex; align-items: center; gap: 12px; padding: 5px 5px 5px 6px; max-width: calc(100vw - 24px);
    background: var(--panel, rgba(17, 24, 36, 0.8)); border: 1px solid var(--line, rgba(110, 135, 175, 0.22)); border-radius: 999px;
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    font: 11px/1.2 var(--mono, ui-monospace, Menlo, monospace); color: var(--ink-500, #7f8ca3); user-select: none; -webkit-user-select: none; }
  .gcx-hud[hidden], .gcx-menu[hidden], .gcx-touch[hidden], .gcx-cross[hidden], .gcx-gauge[hidden] { display: none !important; }
  .gcx-hud b { color: var(--ink-100, #f1f4f9); font-weight: 600; }
  .gcx-seg { display: flex; gap: 2px; padding: 2px; border-radius: 999px; background: rgba(255, 255, 255, 0.05); flex: none; }
  .gcx-seg button, .gcx-exit { font: inherit; border: 0; cursor: pointer; border-radius: 999px; padding: 6px 11px; background: none; color: var(--ink-300, #c2cad8); }
  .gcx-seg button:hover, .gcx-exit:hover { color: var(--ink-100, #f1f4f9); background: rgba(255, 255, 255, 0.06); }
  .gcx-seg button.on { background: var(--accent, #64dedb); color: var(--accent-ink, #082524); font-weight: 600; }
  .gcx-hint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .gcx-gauge { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--ink-300, #c2cad8); flex: none; }
  .gcx-exit { flex: none; background: rgba(255, 255, 255, 0.06); }
  .gcx-hud kbd, .gcx-menu kbd { font: 600 9px/1 var(--mono, monospace); padding: 2px 4px; border-radius: 4px; border: 1px solid var(--line, rgba(110, 135, 175, 0.3)); color: var(--ink-500, #7f8ca3); margin-right: 4px; }
  .gcx-menu { position: fixed; z-index: 60; display: flex; flex-direction: column; gap: 2px; padding: 5px; min-width: 150px;
    background: rgba(17, 24, 36, 0.97); border: 1px solid var(--line, rgba(110, 135, 175, 0.22)); border-radius: 10px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); }
  .gcx-menu button { display: flex; align-items: center; justify-content: space-between; gap: 18px; border: 0; background: none; cursor: pointer;
    font: 12px var(--mono, monospace); color: var(--ink-300, #c2cad8); padding: 9px 10px; border-radius: 7px; text-align: left; }
  .gcx-menu button:hover { background: rgba(255, 255, 255, 0.06); color: var(--ink-100, #f1f4f9); }
  .gcx-menu button.on { color: var(--accent, #64dedb); }
  .gcx-menu kbd { margin: 0; }
  .gcx-cross { position: fixed; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; z-index: 25; pointer-events: none;
    background: rgba(255, 255, 255, 0.9); box-shadow: 0 0 0 1.5px rgba(10, 13, 22, 0.85); }
  .gcx-stick { position: fixed; z-index: 31; left: max(18px, env(safe-area-inset-left)); bottom: calc(var(--transport-h, 96px) + 70px);
    width: 124px; height: 124px; border-radius: 50%; touch-action: none; background: rgba(17, 24, 36, 0.45);
    border: 1.5px solid rgba(241, 244, 249, 0.25); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .gcx-knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
    background: rgba(100, 222, 219, 0.85); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4); pointer-events: none; }
  .gcx-acts { position: fixed; z-index: 31; right: max(18px, env(safe-area-inset-right)); bottom: calc(var(--transport-h, 96px) + 76px);
    display: flex; flex-direction: column; gap: 12px; }
  .gcx-act { width: 66px; height: 66px; border-radius: 50%; touch-action: none; font: 600 13px var(--mono, monospace); color: var(--ink-100, #f1f4f9);
    background: rgba(17, 24, 36, 0.55); border: 1.5px solid rgba(241, 244, 249, 0.3); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .gcx-act.on { background: rgba(100, 222, 219, 0.85); color: var(--accent-ink, #082524); }
  .gcx-hud.gcx-touchy .gcx-hint { display: none; }
  @media (max-width: 900px), (max-height: 500px) {
    .gcx-hint { display: none; }
    .gcx-hud { bottom: auto; top: calc(var(--topbar-h, 58px) + 10px); gap: 6px; }
    .gcx-seg button, .gcx-exit { padding: 6px 9px; }
    .gcx-exit kbd { display: none; }
    /* Touch controls need the corners: tuck the host's floating cards away while exploring. */
    body.gcx-on #explorer, body.gcx-on #feed, body.gcx-on #legend { visibility: hidden; }
  }`;
  document.head.append(s);
}

// Full-screen travel warp (see postRender): radial zoom blur toward the vanishing
// point with a chromatic stretch, speed streaks racing outward, a teal tint, and an
// layered cloud sky that covers the city during loading. uReduced: a plain crossfade.
export const WARP_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform float uAmt, uWhite, uTime, uReduced;
uniform float uOpening;
uniform float uDay;
uniform vec2 uRes;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.0), d = vUv - 0.5, q = d * asp;
  float r = length(q);
  vec3 col;
  if (uReduced > 0.5) {
    col = texture2D(tMap, vUv).rgb;
  } else {
    vec3 acc = vec3(0.0);
    float k = uAmt * 0.34;
    for (int i = 0; i < 12; i++) {
      float t = float(i) / 11.0, s = 1.0 - k * t, ca = uAmt * 0.02 * (0.3 + t);
      acc.r += texture2D(tMap, 0.5 + d * (s - ca)).r;
      acc.g += texture2D(tMap, 0.5 + d * s).g;
      acc.b += texture2D(tMap, 0.5 + d * (s + ca)).b;
    }
    col = acc / 12.0;
    float ang = atan(d.y, d.x), lane = floor(ang * 40.0), h = hash(vec2(lane, 7.0));
    float dash = smoothstep(0.6, 1.0, fract(r * (1.4 + h * 2.2) - uTime * (1.6 + h * 2.6) + h * 9.0));
    col += mix(vec3(0.20, 0.32, 0.52), vec3(0.86, 1.0, 1.0), uDay) * step(0.7, h) * dash * smoothstep(0.12, 0.75, r) * uAmt;
    col = mix(col, col * vec3(0.55, 1.0, 0.98) + mix(vec3(0.008, 0.018, 0.04), vec3(0.03, 0.14, 0.14), uDay), uAmt * (0.3 + 0.45 * smoothstep(0.1, 0.85, r)));
  }
  // Fly between two cloud banks, with blue atmosphere visible between them.
  // Different scales and drift speeds give the foreground and distance depth.
  float skyTime = uReduced > 0.5 ? 0.0 : uTime;
  vec2 drift = vec2(skyTime * 0.045, -skyTime * 0.018);
  float cloud = fbm(q * 3.2 + drift);
  float nearCloud = fbm(q * 5.0 + vec2(-skyTime * 0.085, skyTime * 0.03) + cloud * 0.65);
  float horizon = exp(-abs(vUv.y - 0.48) * 4.5);
  vec3 zenith = mix(vec3(0.012, 0.022, 0.065), vec3(0.16, 0.40, 0.66), uDay);
  vec3 horizonColor = mix(vec3(0.055, 0.085, 0.16), vec3(0.65, 0.84, 0.91), uDay);
  vec3 sky = mix(zenith, horizonColor, horizon);
  float bank = smoothstep(0.06, 0.44, abs(d.y));
  float distant = smoothstep(0.43, 0.7, cloud + bank * 0.16);
  sky = mix(sky, mix(vec3(0.09, 0.12, 0.21), vec3(0.80, 0.89, 0.94), uDay), distant * 0.8);
  float density = smoothstep(0.46, 0.7, nearCloud + bank * 0.22);
  float light = smoothstep(0.4, 0.72, nearCloud + d.y * 0.16);
  vec3 cloudShadow = mix(vec3(0.025, 0.04, 0.09), vec3(0.40, 0.59, 0.74), uDay);
  vec3 cloudLight = mix(vec3(0.16, 0.20, 0.31), vec3(1.0, 0.97, 0.88), uDay);
  vec3 cloudColor = mix(cloudShadow, cloudLight, light);
  sky = mix(sky, cloudColor, density);
  // A broad warm glow on the horizon gives the clouds a light direction.
  float sunlight = exp(-length((q - vec2(0.32, 0.13)) * vec2(1.0, 1.5)) * 4.0);
  sky += mix(vec3(0.015, 0.025, 0.055), vec3(0.18, 0.12, 0.045), uDay) * sunlight * (1.0 - density * 0.65);
  if (uReduced > 0.5) {
    col = mix(col, sky, uWhite);
  } else {
    // Reach every corner even on ultrawide screens; the old fixed radius
    // could expose the island swap at the sides while loading.
    float coverRadius = length(asp * 0.5) + 0.3;
    float edge = uWhite * coverRadius - 0.1 - r + (cloud - 0.5) * 0.2;
    float m = smoothstep(-0.04, 0.08, edge) * smoothstep(0.0, 0.05, uWhite);
    col = mix(col, sky, m);
  }
  // First arrival echoes the README HUD: a hot horizontal line opens into
  // an iris. Sample the city at its real proportions behind the light veil.
  // Travel leaves uOpening at 1 and keeps its original cloud morph.
  if (uOpening < 1.0 && uReduced < 0.5) {
    float halfHeight = mix(0.002, 0.56, uOpening);
    float edge = abs(d.y) - halfHeight;
    float veil = smoothstep(-0.008, 0.008, edge);
    vec3 dark = vec3(0.025, 0.065, 0.085);
    col = mix(col, dark, veil);
    float beam = exp(-abs(edge) * 190.0);
    float halo = exp(-abs(edge) * 30.0) * 0.22;
    float streak = 0.8 + 0.2 * sin(vUv.x * 90.0 - uTime * 18.0);
    col += vec3(0.5, 1.0, 0.94) * (beam + halo) * streak * (1.0 - uOpening);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// Travel styles: the arrival card over the whiteout and the failure toast.
export function injectTravelStyle() {
  if (document.getElementById('gcx-travel-style')) return;
  const s = document.createElement('style');
  s.id = 'gcx-travel-style';
  s.textContent = `
  .gcx-warp { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; pointer-events: none; }
  .gcx-warp[hidden], .gcx-toast[hidden] { display: none !important; }
  .gcx-warp-card { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 0 20px; text-align: center;
    opacity: 0; transform: scale(0.86); transition: opacity 0.35s ease, transform 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3); }
  .gcx-warp.show .gcx-warp-card { opacity: 1; transform: none; animation: gcx-bob 1.8s ease-in-out 0.5s infinite; }
  @keyframes gcx-bob { 50% { transform: translateY(-7px); } }
  .gcx-warp-av { width: 104px; height: 104px; border-radius: 50%; object-fit: cover; background: #2b3a55;
    border: 6px solid #0a0d16; box-shadow: 0 0 0 6px #f6efe1, 0 14px 30px rgba(8, 37, 36, 0.3); }
  .gcx-warp-title { font: 700 clamp(20px, 3vw, 32px)/1.15 var(--display, system-ui, sans-serif); color: #0a1a24; }
  .gcx-warp-sub { font: 600 11px var(--mono, ui-monospace, monospace); letter-spacing: 0.16em; text-transform: uppercase; color: #1d5a5b; }
  @media (prefers-reduced-motion: reduce) { .gcx-warp-card { transition: opacity 0.3s; transform: none; } .gcx-warp.show .gcx-warp-card { animation: none; } }
  .gcx-toast { position: fixed; left: 50%; top: calc(var(--topbar-h, 58px) + 16px); transform: translateX(-50%); z-index: 70; max-width: calc(100vw - 24px);
    padding: 10px 16px; border-radius: 10px; background: rgba(44, 18, 24, 0.94); border: 1px solid rgba(255, 128, 120, 0.4);
    color: #ffe9e6; font: 12px/1.4 var(--mono, ui-monospace, monospace); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4); }
  .gcx-next { color: var(--accent, #64dedb); }
  @media (max-width: 1760px) { .gcx-next .gcx-lbl-wide { display: none; } } /* keep the top bar on one line */
  .gcx-next:disabled, .gcx-next-hud:disabled { opacity: 0.45; cursor: default; }
  .gcx-next-hud { flex: none; font: inherit; border: 0; cursor: pointer; border-radius: 999px; padding: 6px 11px;
    background: rgba(100, 222, 219, 0.14); color: var(--accent, #64dedb); }
  .gcx-next-hud:hover:not(:disabled) { background: rgba(100, 222, 219, 0.24); }
  @media (max-width: 900px), (max-height: 500px) { .gcx-next-hud .gcx-lbl { display: none; } .gcx-next-hud { padding: 6px 9px; } }`;
  document.head.append(s);
}
