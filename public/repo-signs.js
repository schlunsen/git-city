/*
 * Git City — repo name signs on the buildings.
 *
 * Every building carries its repo's name so it can be read from the explore
 * modes:
 *  - a fascia sign on all four sides of the ground floor, at eye level for
 *    walking and driving;
 *  - a two-line rooftop board (name / ★ stars · language) standing on the
 *    roof edge, facing out from the plaza and readable from both sides, for
 *    flying and the orbit view;
 *  - on the tallest towers, a "crown" sign on all four sides just under the
 *    top roof, like the logo on a skyscraper.
 * Labels are painted into shared canvas atlases; each building gets one sign
 * mesh (two material groups) parented to it, so it follows the building and is
 * disposed with it. Materials are unlit, so the signs read as lit at night.
 *
 * THREE is passed in by the host so this module works with its import map.
 */

const ATLAS = 2048;
const FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const FASCIA = { w: 512, h: 96 };
const ROOF = { w: 512, h: 160 };

let atlases = []; // every atlas made for the current city; disposed on rebuild

const fmtStars = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${n}`);
const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

function fitText(g, text, weight, size, min, maxW) {
  g.font = `${weight} ${size}px ${FONT}`;
  while (g.measureText(text).width > maxW && size > min) { size -= 2; g.font = `${weight} ${size}px ${FONT}`; }
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

// Ground-floor fascia: dark enamel, language stripe, name + gold star count.
function paintFascia(g, repo, color, sign) {
  const { w, h } = FASCIA, pad = 6;
  g.fillStyle = '#172033';
  g.beginPath(); g.roundRect(pad, pad, w - pad * 2, h - pad * 2, 16); g.fill();
  g.save(); g.clip(); g.fillStyle = hex(color); g.fillRect(pad, pad, 16, h - pad * 2); g.restore();
  g.lineWidth = 5; g.strokeStyle = '#0a0d16';
  g.beginPath(); g.roundRect(pad, pad, w - pad * 2, h - pad * 2, 16); g.stroke();
  const stars = repo.stargazers_count || 0;
  g.textBaseline = 'middle';
  let starW = 0;
  if (stars > 0) {
    const s = `★ ${fmtStars(stars)}`;
    g.font = `700 30px ${FONT}`;
    starW = g.measureText(s).width + 22;
    g.fillStyle = '#ffcf5a'; g.textAlign = 'right';
    g.fillText(s, w - 22, h / 2 + 1);
  }
  const text = fitText(g, sign || repo.name || '', 800, 50, 20, w - 58 - starW);
  g.fillStyle = '#f7f2e6'; g.textAlign = 'left';
  g.fillText(text, 36, h / 2 + 2);
}

// Rooftop board: bright cream billboard with a band in the language colour.
function paintRoof(g, repo, color, sign) {
  const { w, h } = ROOF, pad = 6;
  g.fillStyle = '#f7efd9';
  g.beginPath(); g.roundRect(pad, pad, w - pad * 2, h - pad * 2, 20); g.fill();
  g.save(); g.clip(); g.fillStyle = hex(color); g.fillRect(pad, pad, w - pad * 2, 18); g.restore();
  g.lineWidth = 7; g.strokeStyle = '#1a2233';
  g.beginPath(); g.roundRect(pad, pad, w - pad * 2, h - pad * 2, 20); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#1a2233';
  g.fillText(fitText(g, repo.name || '', 800, 66, 22, w - 60), w / 2, 72);
  const bits = [`★ ${fmtStars(repo.stargazers_count || 0)}`];
  if (repo.language) bits.push(repo.language);
  g.fillStyle = '#2f7f6b';
  g.fillText(fitText(g, sign || bits.join(' · '), 700, 32, 16, w - 60), w / 2, 124);
}

function makeAtlas(THREE, cell) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.shared = true; // owned here, not by the building
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.FrontSide });
  mat.userData.shared = true;
  const cols = Math.floor(ATLAS / cell.w), rows = Math.floor(ATLAS / cell.h);
  const a = { g: canvas.getContext('2d'), tex, mat, cell, cols, per: cols * rows, used: 0 };
  atlases.push(a);
  return a;
}

// Reserve a cell in the current atlas of this kind, paint it, return its UV rect.
function place(THREE, family, cell, paint) {
  let a = family.at(-1);
  if (!a || a.used >= a.per) { a = makeAtlas(THREE, cell); family.push(a); }
  const slot = a.used++, col = slot % a.cols, row = Math.floor(slot / a.cols);
  const x = col * cell.w, y = row * cell.h;
  a.g.save(); a.g.translate(x, y); paint(a.g); a.g.restore();
  // flipY: canvas row 0 is the top of the texture.
  return { a, uv: [(x + 2) / ATLAS, 1 - (y + cell.h - 2) / ATLAS, (x + cell.w - 2) / ATLAS, 1 - (y + 2) / ATLAS] };
}

// One quad facing outward along (nx, nz), text reading left-to-right from there.
function quad(out, ox, cy, oz, nx, nz, w, h, uv) {
  const rx = nz, rz = -nx, hw = w / 2, hh = h / 2, b = out.pos.length / 3;
  out.pos.push(
    ox - rx * hw, cy - hh, oz - rz * hw,
    ox + rx * hw, cy - hh, oz + rz * hw,
    ox + rx * hw, cy + hh, oz + rz * hw,
    ox - rx * hw, cy + hh, oz - rz * hw,
  );
  out.uv.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
  out.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
}
function ringOfQuads(out, cx, cy, cz, half, w, h, uv) {
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) quad(out, cx + nx * (half + 0.05), cy, cz + nz * (half + 0.05), nx, nz, w, h, uv);
}

/**
 * @param THREE
 * @param {Array} buildings  the host's building entries ({ mesh, bodies, repo })
 * @param {(repo) => number} colorFor  language colour for a repo
 * @param {{ signFor?: (repo) => string|undefined }} [opts]
 *   signFor: the developer's own sign text (city.json repos[name].sign): it
 *   replaces the name on the shop fascias and the stats line on the roof board.
 */
export function buildRepoSigns(THREE, buildings, colorFor = () => 0x64dedb, { signFor } = {}) {
  for (const a of atlases) { a.tex.dispose(); a.mat.dispose(); }
  atlases = [];
  const fascias = [], roofs = [];
  for (const b of buildings) {
    const bodies = b.bodies || (b.body ? [b.body] : []);
    if (!bodies.length) continue;
    const color = colorFor(b.repo), sign = signFor?.(b.repo) || '';
    const F = place(THREE, fascias, FASCIA, (g) => paintFascia(g, b.repo, color, sign));
    const R = place(THREE, roofs, ROOF, (g) => paintRoof(g, b.repo, color, sign));
    const fo = { pos: [], uv: [], idx: [] }, ro = { pos: [], uv: [], idx: [] };

    // Ground-floor fascia on all four sides, at eye level.
    const first = bodies[0], p = first.geometry.parameters;
    {
      const w = Math.min(p.width * 0.92, 5.2), h = w * (FASCIA.h / FASCIA.w);
      const bottom = first.position.y - p.height / 2;
      ringOfQuads(fo, first.position.x, bottom + Math.min(p.height - 0.35 - h / 2, 2.75), first.position.z, p.width / 2, w, h, F.uv);
    }
    // Crown on the tallest towers, just under the top roof.
    const top = bodies[bodies.length - 1], tp = top.geometry.parameters;
    const topY = top.position.y + tp.height / 2;
    if (topY > 18) {
      const w = Math.min(tp.width * 0.96, 7.5), h = w * (FASCIA.h / FASCIA.w);
      ringOfQuads(fo, top.position.x, topY - h / 2 - 0.3, top.position.z, tp.width / 2, w, h, F.uv);
    }
    // Rooftop board on the roof edge that faces away from the plaza (both sides readable).
    {
      const gx = b.mesh.position.x + top.position.x, gz = b.mesh.position.z + top.position.z;
      let nx = gx, nz = gz;
      const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
      // Snap to the nearest face normal so the board sits square on the roof edge.
      if (Math.abs(nx) > Math.abs(nz)) { nx = Math.sign(nx); nz = 0; } else { nz = Math.sign(nz) || 1; nx = 0; }
      const w = Math.max(3.2, Math.min(tp.width * 1.25, 7.5)), h = w * (ROOF.h / ROOF.w);
      const edge = tp.width / 2 - 0.35, y = topY + 0.75 + 0.15 + h / 2; // above the 0.7 roof cap
      const ox = top.position.x + nx * edge, oz = top.position.z + nz * edge;
      quad(ro, ox + nx * 0.02, y, oz + nz * 0.02, nx, nz, w, h, R.uv);    // facing out
      quad(ro, ox - nx * 0.02, y, oz - nz * 0.02, -nx, -nz, w, h, R.uv);  // facing the plaza
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...fo.pos, ...ro.pos], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([...fo.uv, ...ro.uv], 2));
    const off = fo.pos.length / 3;
    geo.setIndex([...fo.idx, ...ro.idx.map((i) => i + off)]);
    geo.addGroup(0, fo.idx.length, 0);
    geo.addGroup(fo.idx.length, ro.idx.length, 1);
    const signMesh = new THREE.Mesh(geo, [F.a.mat, R.a.mat]);
    signMesh.name = 'repo-sign';
    signMesh.raycast = () => {}; // clicks still hit the building
    b.mesh.add(signMesh);
  }
  for (const a of atlases) a.tex.needsUpdate = true;
}
