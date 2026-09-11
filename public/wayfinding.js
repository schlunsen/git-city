// ---------------------------------------------------------------------------
// wayfinding.js — finding your way around Git City at street level.
//
// buildWayfinding(THREE, opts) -> { group, update(dt, elapsed, camera, dayFactor, mode), dispose() }
//
// Two things on top of the repo signs on the buildings (repo-signs.js):
//   street signs — every inner street is named after the most-starred repo
//                  fronting it ("linux Ave" runs north-south, "subsurface St"
//                  east-west), shown on green corner blades at every other
//                  crossing: the classic two-blade post, each blade parallel
//                  to the street it names.
//   name tag     — in the explore modes (walk / drive / fly), a card with the
//                  repo's name, stars, language and description floats in
//                  front of the building you are heading for, and fades
//                  across as you move on. Flat facade signs are hard to read
//                  at a glancing angle down a street; the tag always faces you.
//
// Cost: street signs are one merged mesh (one canvas atlas) plus the posts as
// one InstancedMesh and its ink hull; the tag is one sprite with its own small
// canvas, drawn only while it shows. Nothing here is pickable.
//
// opts: { parent, buildings, streets, cell?, plazaRadius?, envMat?, ink? }
//   buildings — app.js entries { mesh, bodies, repo, h, roofMat }, most-starred first
//   streets   — street centrelines { x0, z0, x1, z1, vertical } (layout.streets),
//               in the same frame as the building groups (parent = their parent).
// ---------------------------------------------------------------------------

const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const DISPLAY = '"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';
const BLADE_H = 0.32;             // world height of a street-name blade
const POST_TOP = 2.0;             // blades sit above head height, under the shop fascias' reach
const ROAD_HALF = 1.6;            // inner streets are 3.2 wide (app.js buildBlock)
const noRaycast = () => {};

let postMat = null;               // street-sign green, created once through envMat

export function buildWayfinding(THREE, opts = {}) {
  const group = new THREE.Group();
  group.name = 'wayfinding';
  (opts.parent || opts.scene)?.add(group);
  const disposables = [];
  const lots = (opts.buildings || []).filter(b => b?.mesh && b.repo).map(b => describeLot(THREE, b));

  let streets = null, tag = null;
  try { streets = buildStreetSigns(THREE, opts, lots, group, disposables); }
  catch (err) { console.error('wayfinding: street signs failed', err); }
  try { tag = buildTag(THREE, lots, group, disposables); }
  catch (err) { console.error('wayfinding: name tag failed', err); }

  return {
    group,
    streetNames: streets?.names || [],
    update(dt, elapsed, camera, dayFactor = 1, mode = 'orbit') {
      // Street signs are reflective, not lit: they dim a little after dark.
      if (streets) streets.mat.color.setScalar(0.62 + 0.38 * dayFactor);
      if (tag && camera) tag.update(dt, camera, mode || 'orbit');
    },
    dispose() {
      group.parent?.remove(group);
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}

// A building's footprint and colour, in its parent's frame.
function describeLot(THREE, b) {
  const body = b.bodies?.[0] || b.body;
  const g = body.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const x = b.mesh.position.x, z = b.mesh.position.z;
  const box = g.boundingBox.clone().translate(body.position).translate(b.mesh.position);
  const hsl = { h: 0, s: 0, l: 0 };
  let color = '#64dedb';
  if (b.roofMat?.color) {
    b.roofMat.color.getHSL(hsl, THREE.SRGBColorSpace);
    if (hsl.s >= 0.2) color = '#' + new THREE.Color().setHSL(hsl.h, 0.8, 0.62, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace);
  }
  return {
    repo: b.repo, x, z, box, color,
    half: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
    h: Number.isFinite(b.h) ? b.h : box.max.y,
  };
}

// ---------------------------------------------------------------------------
// Street signs
// ---------------------------------------------------------------------------
function buildStreetSigns(THREE, opts, lots, group, disposables) {
  const CELL = opts.cell ?? 9, plazaR = opts.plazaRadius ?? 15.3;
  // Street centrelines, merged into lines (one name per line).
  const byKey = new Map();
  for (const s of opts.streets || []) {
    const v = !!s.vertical, p = v ? s.x0 : s.z0;
    const key = `${v ? 'v' : 'h'}${Math.round(p * 2)}`;
    if (!byKey.has(key)) byKey.set(key, { v, p, segs: [], len: 0, name: null });
    const L = byKey.get(key), a = v ? s.z0 : s.x0, c = v ? s.z1 : s.x1;
    L.segs.push([Math.min(a, c), Math.max(a, c)]);
    L.len += Math.abs(c - a);
  }
  const lines = [...byKey.values()];
  if (!lines.length || !lots.length) return null;
  const covers = (L, t, m) => L.segs.some(([a, c]) => t > a + m && t < c - m);

  // Name each line after the most-starred repo fronting it (lots come most-starred
  // first); a repo names one street, and avenues and streets take turns.
  let nv = 0, nh = 0;
  for (const lot of lots) {
    let best = null, bestScore = Infinity;
    for (const L of lines) {
      if (L.name) continue;
      const across = Math.abs((L.v ? lot.x : lot.z) - L.p);
      if (across > CELL * 0.75 || !covers(L, L.v ? lot.z : lot.x, -1)) continue;
      const score = across + (L.v ? nv - nh : nh - nv) - L.len * 1e-3;
      if (score < bestScore) { bestScore = score; best = L; }
    }
    if (!best) continue;
    best.name = lot.repo.name;
    if (best.v) nv++; else nh++;
  }
  const named = lines.filter(L => L.name);
  if (!named.length) return null;

  // Posts at every other crossing of two named streets, on the corner whose
  // pavement is clearest (never inside a footprint, never on the road).
  const clearance = (x, z) => Math.min(...lots.map(({ box }) =>
    Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z))));
  const posts = [];
  for (const a of named) if (a.v) for (const b of named) if (!b.v) {
    if (!covers(a, b.p, 0.5) || !covers(b, a.p, 0.5)) continue;
    if (Math.hypot(a.p, b.p) < plazaR + 2) continue;
    const i = Math.round(a.p / CELL - 0.5), j = Math.round(b.p / CELL - 0.5);
    if (((i + j) % 2 + 2) % 2) continue;
    let best = null;
    for (const [sx, sz] of [[1, -1], [-1, 1], [1, 1], [-1, -1]]) {
      for (const d of [ROAD_HALF + 0.35, ROAD_HALF + 0.12]) {
        const x = a.p + sx * d, z = b.p + sz * d, c = clearance(x, z);
        if (c < 0.3) continue;
        if (!best || c > best.c + 0.05) best = { x, z, c };
        break;
      }
    }
    if (best) posts.push({ x: best.x, z: best.z, ave: a, st: b });
  }
  if (!posts.length) return null;

  // Atlas: one blade per named line.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const CH = 64, PAD = 20, RIM = 6, W = 1024;
  ctx.font = `600 36px ${MONO}`;
  const used = named.filter(L => posts.some(p => p.ave === L || p.st === L));
  const cells = used.map(L => {
    const text = `${ellipsize(L.name, 18)} ${L.v ? 'Ave' : 'St'}`;
    return { L, text, w: Math.min(W - 8, Math.ceil(ctx.measureText(text).width) + 2 * (PAD + RIM)), h: CH };
  });
  let x = 4, y = 4;
  for (const c of cells) {
    if (x + c.w + 4 > W) { x = 4; y += CH + 4; }
    c.x = x; c.y = y; x += c.w + 4;
  }
  canvas.width = W;
  canvas.height = Math.ceil((y + CH + 4) / 4) * 4;
  for (const c of cells) {
    ctx.save();
    ctx.translate(c.x, c.y);
    roundRect(ctx, 0, 0, c.w, CH, 10); ctx.fillStyle = '#0a0d16'; ctx.fill();      // ink edge
    roundRect(ctx, 2, 2, c.w - 4, CH - 4, 9); ctx.fillStyle = '#f3f6ee'; ctx.fill(); // white border
    roundRect(ctx, RIM, RIM, c.w - 2 * RIM, CH - 2 * RIM, 6); ctx.fillStyle = '#1f7a4c'; ctx.fill();
    ctx.fillStyle = '#f7faf2';
    ctx.font = `600 36px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.text, c.w / 2, CH / 2 + 2, c.w - 2 * (PAD + RIM) + 4);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const cellOf = new Map(cells.map(c => [c.L, c]));

  // Blades: two quads back to back, each reading left to right from its side.
  const pos = [], uv = [], idx = [], e = 0.006;
  const blade = (cx, y0, cz, ux, uz, c) => {
    let h = BLADE_H, w = h * c.w / c.h;
    if (w > 2.4) { h *= 2.4 / w; w = 2.4; }
    const nx = -uz, nz = ux; // front normal: its viewer's right is +u
    const u0 = (c.x + 0.5) / W, u1 = (c.x + c.w - 0.5) / W;
    const v1 = 1 - (c.y + 0.5) / canvas.height, v0 = 1 - (c.y + c.h - 0.5) / canvas.height;
    for (const s of [1, -1]) {
      const ox = cx + nx * e * s, oz = cz + nz * e * s, rx = ux * s, rz = uz * s, b = pos.length / 3;
      pos.push(ox - rx * w / 2, y0, oz - rz * w / 2, ox + rx * w / 2, y0, oz + rz * w / 2,
        ox + rx * w / 2, y0 + h, oz + rz * w / 2, ox - rx * w / 2, y0 + h, oz - rz * w / 2);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return h;
  };
  const _m = new THREE.Matrix4(), boxes = [];
  for (const p of posts) {
    const h1 = blade(p.x, POST_TOP, p.z, 1, 0, cellOf.get(p.st));        // names the east-west street
    const capY = POST_TOP + h1 + 0.02;
    blade(p.x, capY + 0.02, p.z, 0, 1, cellOf.get(p.ave));               // names the north-south avenue
    boxes.push(_m.makeScale(0.11, POST_TOP, 0.11).setPosition(p.x, POST_TOP / 2, p.z).clone());
    boxes.push(_m.makeScale(0.17, 0.05, 0.17).setPosition(p.x, capY, p.z).clone());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5 });
  const signs = new THREE.Mesh(geo, mat);

  if (!postMat) {
    postMat = opts.envMat ? opts.envMat(0x0d2a1d, 0x2e6a48) : new THREE.MeshLambertMaterial({ color: 0x2e6a48 });
    postMat.userData.shared = true; // kept for the page's lifetime (envMat recolours it by day)
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const meshes = [signs, instanced(THREE, boxGeo, postMat, boxes, 0)];
  if (opts.ink) meshes.push(instanced(THREE, boxGeo, opts.ink, boxes, 0.06));
  for (const m of meshes) { m.raycast = noRaycast; group.add(m); }
  disposables.push(tex, geo, mat, boxGeo);
  return { mat, names: used.map(L => `${L.name} ${L.v ? 'Ave' : 'St'}`) };
}

function instanced(THREE, geo, mat, matrices, grow) {
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), m = new THREE.Matrix4();
  matrices.forEach((mx, i) => {
    if (grow) { mx.decompose(p, q, s); mesh.setMatrixAt(i, m.compose(p, q, s.addScalar(grow))); }
    else mesh.setMatrixAt(i, mx);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------------------
// Name tag (explore modes)
// ---------------------------------------------------------------------------
function buildTag(THREE, lots, group, disposables) {
  const W = 640, H = 212, CARD = 178;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0);   // anchored at the tail's tip
  sprite.raycast = noRaycast;
  sprite.visible = false;
  sprite.renderOrder = 3;
  group.add(sprite);
  disposables.push(tex, mat);

  const fwd = new THREE.Vector3(), cam = new THREE.Vector3(), local = new THREE.Vector3();
  let current = null, opacity = 0;
  const RANGE = { walk: 26, drive: 40, fly: 80 };

  function pick(mode) {
    const range = RANGE[mode];
    if (!range) return null;
    let best = null, bestScore = Infinity;
    for (const lot of lots) {
      const dx = lot.x - cam.x, dz = lot.z - cam.z, d = Math.hypot(dx, dz) || 1;
      const edge = Math.max(0.1, d - lot.half);
      if (edge > range) continue;
      // On foot or on wheels, a building you are already beside shows its own
      // fascia; the tag names the next one ahead (and lets go once you arrive).
      if (mode !== 'fly' && edge < (lot === current ? 3.2 : 4.8)) continue;
      const cos = (dx * fwd.x + dz * fwd.z) / d;
      if (cos < 0.45) continue;                 // ahead of you
      let score = edge * (1.9 - cos);
      if (lot === current) score *= 0.7;        // a little stickiness: no flicker between neighbours
      if (score < bestScore) { bestScore = score; best = lot; }
    }
    return best;
  }

  function paint(lot) {
    const r = lot.repo;
    ctx.clearRect(0, 0, W, H);
    // Card with a tail pointing down at the building, in the fascias' enamel.
    ctx.beginPath();
    roundRectPath(ctx, 6, 6, W - 12, CARD - 6, 22);
    ctx.moveTo(W / 2 - 22, CARD); ctx.lineTo(W / 2, H - 6); ctx.lineTo(W / 2 + 22, CARD);
    ctx.fillStyle = 'rgba(19, 27, 44, 0.94)'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = '#0a0d16'; ctx.stroke();
    ctx.save();
    ctx.beginPath(); roundRectPath(ctx, 6, 6, W - 12, CARD - 6, 22); ctx.clip();
    ctx.fillStyle = lot.color; ctx.fillRect(6, 6, 16, CARD);
    ctx.restore();
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const left = 42, maxW = W - left - 30;
    ctx.fillStyle = '#f7f2e6';
    fitText(ctx, r.name || '', `700 SIZEpx ${DISPLAY}`, 52, 30, maxW, left, 70);
    ctx.font = `600 24px ${MONO}`;
    const stars = `★ ${fmtStars(r.stargazers_count || 0)}`;
    ctx.fillStyle = '#ffcf5a'; ctx.fillText(stars, left, 112);
    const sw = ctx.measureText(stars + '  ').width;
    if (r.language) { ctx.fillStyle = lot.color; ctx.fillText(`● ${r.language}`, left + sw, 112); }
    if (r.description) {
      ctx.font = `400 22px ${DISPLAY}`;
      ctx.fillStyle = '#b9c5d8';
      ctx.fillText(clip(ctx, r.description, maxW), left, 152);
    }
    tex.needsUpdate = true;
  }

  return {
    update(dt, camera, mode) {
      camera.getWorldPosition(cam);
      if (group.parent) group.parent.worldToLocal(cam);
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const want = pick(mode);
      if (want !== current) {
        opacity = Math.max(0, opacity - dt * 7);      // fade out, then swap
        if (opacity === 0) { current = want; if (current) paint(current); }
      } else if (current) opacity = Math.min(1, opacity + dt * 4);
      sprite.visible = !!current && opacity > 0.01;
      mat.opacity = opacity;
      if (!current) return;
      // In front of the facade that faces you, above the shop fascia; over the roof when flying.
      const dx = cam.x - current.x, dz = cam.z - current.z, d = Math.hypot(dx, dz) || 1;
      if (mode === 'fly') local.set(current.x, current.h + 2.2, current.z);
      else {
        // Tail tip just above the fascias (and a little over a chase camera's eye line).
        const y = Math.min(Math.max(cam.y + 0.7, 3.35), Math.max(3.35, current.h - 0.6));
        local.set(current.x + dx / d * (current.half + 0.9), y, current.z + dz / d * (current.half + 0.9));
      }
      sprite.position.copy(local);
      // About the same size on screen near or far (a fifth of the view), never huge.
      const dist = Math.hypot(local.x - cam.x, local.y - cam.y, local.z - cam.z);
      const w = Math.min(8, Math.max(1.5, dist * 0.3));
      sprite.scale.set(w, w * H / W, 1);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fitText(ctx, text, fontTpl, max, min, maxW, x, y) {
  let size = max;
  ctx.font = fontTpl.replace('SIZE', size);
  while (ctx.measureText(text).width > maxW && size > min) { size -= 2; ctx.font = fontTpl.replace('SIZE', size); }
  ctx.fillText(clip(ctx, text, maxW), x, y);
}
function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
function fmtStars(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
function ellipsize(s, max) { s = String(s); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); }
