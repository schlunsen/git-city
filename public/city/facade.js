import * as THREE from 'three';
import { renderer } from './scene.js';
import { roundRect } from './toon.js';

// ---------------------------------------------------------------------------
// Facade painting — each tier gets an albedo canvas (walls, frames, shopfront,
// awning) and an emissive canvas (which windows are lit) so night glow varies
// per window instead of every pane lighting identically.
// ---------------------------------------------------------------------------
const FACADE_PX = 22;   // texture pixels per world unit
const FLOOR_H = 2.6;    // world units per storey
export const WIN_STYLES = ['square', 'arch', 'ribbon', 'slender', 'glass', 'balcony'];
const _hsl = { h: 0, s: 0, l: 0 };
// theme: a building theme (themes.js). Its tint pulls every wall toward one
// material (adobe, whitewash, timber) so the block reads as one town while the
// language hue still tells the buildings apart.
export function buildingPalette(hex, variation = 0.5, theme = null) {
  new THREE.Color(hex).getHSL(_hsl);
  const grey = _hsl.s < 0.12;
  const [s0, s1] = theme?.sat || [0.4, 0.62], [l0, l1] = theme?.lig || [0.58, 0.7];
  const sat = grey ? _hsl.s : THREE.MathUtils.clamp(_hsl.s, s0, s1);
  const lig = THREE.MathUtils.clamp(_hsl.l, l0, l1) + (variation - 0.5) * 0.16;
  const wall = new THREE.Color().setHSL(_hsl.h, sat, lig);
  if (theme?.tint) wall.lerp(new THREE.Color(theme.tint), theme.tintK ?? 0.5);
  const roof = theme?.roofColor
    ? new THREE.Color(theme.roofColor).lerp(wall, 0.15)
    : new THREE.Color().setHSL(_hsl.h, Math.min(1, sat + 0.08), lig * 0.5);
  return { wall, roof, accent: new THREE.Color().setHSL((_hsl.h + 0.5) % 1, grey ? 0.5 : 0.7, 0.56) };
}
const hexCss = (c) => '#' + c.getHexString();
let facadeAniso = 0;
// wall: 'auto' (brick under square windows, plain elsewhere) | 'brick' | 'plaster' | 'timber' | 'clapboard'.
// shutters: a colour for shutters beside the windows. awning: 'stripes' | 'canvas' | 'tin' | 'wood'.
export function paintFacade(rnd, pal, w, h, { ground = false, style = 'square', litProb = 0.65, wall: wallKind = 'auto', shutters = null, awning = 'stripes', panes = null } = {}) {
  const u = FACADE_PX;
  const cw = Math.max(24, Math.round(w * u)), ch = Math.max(24, Math.round(h * u));
  const alb = document.createElement('canvas'); alb.width = cw; alb.height = ch;
  const emi = document.createElement('canvas'); emi.width = cw; emi.height = ch;
  const a = alb.getContext('2d'), e = emi.getContext('2d');
  const wall = hexCss(pal.wall), accent = hexCss(pal.accent);
  a.fillStyle = wall; a.fillRect(0, 0, cw, ch);
  e.fillStyle = '#000'; e.fillRect(0, 0, cw, ch);
  const Y = (wy) => ch - wy * u; // world height → canvas row

  // Storey bands, edge pilasters and a cornice under the roof.
  const floors = Math.floor(h / FLOOR_H);
  a.fillStyle = 'rgba(0,0,0,0.10)';
  for (let fl = 1; fl <= floors; fl++) a.fillRect(0, Y(fl * FLOOR_H), cw, 2);
  const pil = Math.max(2, 0.18 * u);
  a.fillStyle = 'rgba(255,255,255,0.12)';
  a.fillRect(0, 0, pil, ch); a.fillRect(cw - pil, 0, pil, ch);
  a.fillStyle = 'rgba(255,255,255,0.16)'; a.fillRect(0, 0, cw, 0.3 * u);
  a.fillStyle = 'rgba(0,0,0,0.18)'; a.fillRect(0, 0.3 * u, cw, 2);

  const treatment = wallKind === 'auto' ? (style === 'square' ? 'brick' : 'plain') : wallKind;
  if (treatment === 'brick') {
    const brickH = 0.23 * u, brickW = 0.65 * u, strong = wallKind === 'brick';
    // Every brick its own shade (fired darker or lighter), then the mortar joints.
    for (let row = 0; row * brickH < ch; row++) {
      const yy = row * brickH;
      for (let xx = (row % 2) * brickW / 2 - brickW; xx < cw; xx += brickW) {
        const r = rnd();
        a.fillStyle = r < 0.3 ? `rgba(40,15,5,${strong ? 0.16 : 0.07})` : r > 0.8 ? `rgba(255,225,190,${strong ? 0.16 : 0.07})` : 'rgba(0,0,0,0)';
        a.fillRect(xx + 1, yy + 1, brickW - 2, brickH - 2);
      }
    }
    a.strokeStyle = strong ? 'rgba(235,220,200,0.32)' : 'rgba(55,37,28,0.12)'; a.lineWidth = strong ? 1.5 : 1;
    a.beginPath();
    for (let row = 0; row * brickH < ch; row++) {
      const yy = row * brickH;
      a.moveTo(0, yy); a.lineTo(cw, yy);
      for (let xx = (row % 2) * brickW / 2; xx < cw; xx += brickW) { a.moveTo(xx, yy); a.lineTo(xx, yy + brickH); }
    }
    a.stroke();
  } else if (treatment === 'plaster') {
    // Sun-baked render: soft mottling, a darker dado and a row of beam ends under each floor.
    for (let n = 0; n < cw * ch / 500; n++) {
      a.fillStyle = `rgba(${rnd() < 0.5 ? '255,240,210' : '90,50,20'},${(0.05 + rnd() * 0.08).toFixed(3)})`;
      const rw = (0.4 + rnd() * 1.6) * u, rh = (0.25 + rnd() * 0.9) * u;
      roundRect(a, rnd() * cw - rw / 2, rnd() * ch - rh / 2, rw, rh, rh / 2); a.fill();
    }
    // Hairline cracks wandering down from a few random points, and rain-streaked
    // weathering that darkens the wall toward the ground.
    a.strokeStyle = 'rgba(70,40,20,0.35)'; a.lineWidth = 1;
    for (let n = 0; n < 1 + cw * ch / 9000; n++) {
      let cx0 = rnd() * cw, cy0 = rnd() * ch * 0.7;
      a.beginPath(); a.moveTo(cx0, cy0);
      for (let k = 0; k < 4 + rnd() * 5; k++) { cx0 += (rnd() - 0.5) * 0.5 * u; cy0 += rnd() * 0.4 * u; a.lineTo(cx0, cy0); }
      a.stroke();
    }
    const wear = a.createLinearGradient(0, ch - 1.4 * u, 0, ch);
    wear.addColorStop(0, 'rgba(80,45,20,0)'); wear.addColorStop(1, 'rgba(80,45,20,0.22)');
    a.fillStyle = wear; a.fillRect(0, ch - 1.4 * u, cw, 1.4 * u);
    a.fillStyle = 'rgba(90,50,20,0.16)';
    for (let fl = 1; fl <= floors; fl++) {
      const yy = Y(fl * FLOOR_H);
      for (let xx = 0.35 * u; xx < cw - 0.2 * u; xx += 0.7 * u) a.fillRect(xx, yy + 3, 0.16 * u, 0.16 * u);
    }
  } else if (treatment === 'timber') {
    // Stacked logs: alternate plank shades with a shadow line between them.
    const plank = 0.32 * u;
    for (let row = 0; row * plank < ch; row++) {
      // Each log is lit along its top and falls into shadow underneath.
      const log = a.createLinearGradient(0, row * plank, 0, row * plank + plank);
      log.addColorStop(0, 'rgba(255,230,190,0.22)'); log.addColorStop(0.45, 'rgba(255,230,190,0.02)'); log.addColorStop(1, 'rgba(50,25,8,0.34)');
      a.fillStyle = log; a.fillRect(0, row * plank, cw, plank);
      a.fillStyle = 'rgba(30,15,5,0.4)'; a.fillRect(0, row * plank, cw, 1.5);
      // Grain: a few long faint streaks, and the odd knot.
      a.strokeStyle = 'rgba(60,30,10,0.14)'; a.lineWidth = 1;
      for (let g = 0; g < 2; g++) { const gy = row * plank + 3 + rnd() * (plank - 6); a.beginPath(); a.moveTo(rnd() * cw * 0.5, gy); a.lineTo(cw * (0.5 + rnd() * 0.5), gy + (rnd() - 0.5) * 2); a.stroke(); }
      if (rnd() < 0.35) { a.fillStyle = 'rgba(50,25,8,0.45)'; a.beginPath(); a.ellipse(rnd() * cw, row * plank + plank / 2, 0.07 * u, 0.05 * u, 0, 0, Math.PI * 2); a.fill(); }
    }
    a.fillStyle = 'rgba(40,20,5,0.35)';
    for (const xx of [0, cw - 0.32 * u]) a.fillRect(xx, 0, 0.32 * u, ch); // corner notches
    a.fillStyle = 'rgba(255,230,190,0.14)';
    for (let row = 0; row * plank < ch; row += 2) for (const xx of [0.04 * u, cw - 0.28 * u]) a.fillRect(xx, row * plank + 2, 0.24 * u, plank - 4);
  } else if (treatment === 'clapboard') {
    // Overlapping boards: a fine highlight above a shadow line every board.
    const board = 0.24 * u;
    for (let row = 0; row * board < ch; row++) {
      const t = rnd();
      a.fillStyle = t < 0.25 ? 'rgba(0,0,0,0.05)' : t > 0.75 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0)';
      a.fillRect(0, row * board, cw, board);
      a.fillStyle = 'rgba(0,0,0,0.16)'; a.fillRect(0, row * board + board - 1.5, cw, 1.5);
      a.fillStyle = 'rgba(255,255,255,0.16)'; a.fillRect(0, row * board, cw, 1.5);
      if (rnd() < 0.12) { a.fillStyle = 'rgba(120,100,80,0.18)'; a.fillRect(rnd() * cw, row * board + 2, (0.3 + rnd() * 0.6) * u, board - 4); } // weathered patch
    }
    a.fillStyle = 'rgba(255,255,255,0.22)';
    a.fillRect(0, 0, 0.22 * u, ch); a.fillRect(cw - 0.22 * u, 0, 0.22 * u, ch); // corner boards
  }
  const frame = 'rgba(0,0,0,0.38)', paneDark = panes || (style === 'glass' ? '#3e7185' : '#26324c');
  const warmths = ['#ffd27a', '#ffe3a6', '#ffc46a', '#fff1c9', '#bfe0ff'];
  const pane = (x0, y0, pw, ph, lit, kind) => {
    a.fillStyle = paneDark; e.fillStyle = lit ? warmths[Math.floor(rnd() * warmths.length)] : '#000';
    if (kind === 'arch') {
      const r = pw / 2;
      for (const ctx of [a, e]) {
        ctx.beginPath(); ctx.moveTo(x0, y0 + ph); ctx.lineTo(x0, y0 + r);
        ctx.arc(x0 + r, y0 + r, r, Math.PI, 0); ctx.lineTo(x0 + pw, y0 + ph); ctx.closePath(); ctx.fill();
      }
      a.strokeStyle = frame; a.lineWidth = 2.5; a.stroke();
    } else {
      const rr = kind === 'ribbon' ? 3 : Math.min(6, pw * 0.22);
      for (const ctx of [a, e]) { roundRect(ctx, x0, y0, pw, ph, rr); ctx.fill(); }
      a.strokeStyle = frame; a.lineWidth = 2.5; roundRect(a, x0, y0, pw, ph, rr); a.stroke();
    }
    if (style === 'glass') {
      const reflection = a.createLinearGradient(x0, y0, x0 + pw, y0 + ph);
      reflection.addColorStop(0, 'rgba(177,225,235,0.5)');
      reflection.addColorStop(0.48, 'rgba(177,225,235,0.08)');
      reflection.addColorStop(0.5, 'rgba(177,225,235,0.3)');
      reflection.addColorStop(1, 'rgba(177,225,235,0.02)');
      a.fillStyle = reflection; a.fillRect(x0 + 2, y0 + 2, pw - 4, ph - 4);
    }
    if (kind === 'square') { // mullion cross in the wall colour
      a.fillStyle = wall; e.fillStyle = '#000';
      for (const ctx of [a, e]) { ctx.fillRect(x0 + pw / 2 - 1.5, y0, 3, ph); ctx.fillRect(x0, y0 + ph / 2 - 1.5, pw, 3); }
    }
    if (lit && rnd() < 0.3) { // someone standing in a lit window
      e.fillStyle = 'rgba(0,0,0,0.6)';
      e.fillRect(x0 + pw * (0.3 + rnd() * 0.3), y0 + ph * 0.45, pw * 0.22, ph * 0.5);
    }
  };

  const cols = Math.max(1, Math.round(w / (style === 'slender' ? 1.05 : 1.55))), cellW = cw / cols;
  if (style === 'slender' || style === 'glass') {
    // Continuous vertical piers give these families a different rhythm at city scale.
    a.fillStyle = style === 'glass' ? '#526f80' : 'rgba(0,0,0,0.13)';
    for (let c = 0; c < cols; c++) a.fillRect(c * cellW + cellW * 0.15, 0.4 * u, cellW * 0.7, ch - 0.4 * u);
  }
  for (let fl = ground ? 1 : 0; fl < floors; fl++) {
    const base = fl * FLOOR_H;
    if (style === 'ribbon' || style === 'glass') {
      if (base + (style === 'glass' ? 2.4 : 1.75) > h - 0.35) break;
      const ph = (style === 'glass' ? 2.15 : 1.0) * u, y0 = Y(base + (style === 'glass' ? 2.4 : 1.75));
      pane(0.25 * u, y0, cw - 0.5 * u, ph, rnd() < litProb, 'ribbon');
      a.fillStyle = frame; e.fillStyle = '#000';
      for (let c = 1; c < cols; c++) { a.fillRect(c * cellW - 1, y0, 2, ph); e.fillRect(c * cellW - 1, y0, 2, ph); }
    } else {
      const pw = Math.min(cellW * (style === 'balcony' ? 0.72 : 0.58), 1.0 * u), ph = (style === 'slender' ? 1.85 : style === 'arch' || style === 'balcony' ? 1.45 : 1.15) * u;
      if (base + 0.65 + ph / u > h - 0.35) break;
      for (let c = 0; c < cols; c++) {
        const wx = c * cellW + (cellW - pw) / 2, wy = Y(base + 0.65) - ph;
        pane(wx, wy, pw, ph, rnd() < litProb, style);
        if (shutters && style !== 'balcony' && cellW - pw > 0.5 * u) {
          // A pair of louvred shutters, hinged either side of the frame.
          const sw = Math.min(0.3 * u, (cellW - pw) / 2 - 3);
          for (const sx of [wx - sw - 2, wx + pw + 2]) {
            a.fillStyle = shutters; a.fillRect(sx, wy, sw, ph);
            a.fillStyle = 'rgba(0,0,0,0.22)';
            for (let yy = wy + 4; yy < wy + ph - 3; yy += 5) a.fillRect(sx + 2, yy, sw - 4, 1.5);
          }
        }
        if (style === 'balcony') {
          // Painted rails and slab shadows add depth without per-floor meshes.
          a.fillStyle = 'rgba(0,0,0,0.24)'; a.fillRect(wx - 4, wy + ph, pw + 8, 7);
          a.fillStyle = '#d6d9ce'; a.fillRect(wx - 4, wy + ph - 2, pw + 8, 3);
          for (const ctx of [a, e]) {
            ctx.fillStyle = '#182b38';
            ctx.fillRect(wx - 3, wy + ph - 10, pw + 6, 2);
            for (let rail = 0; rail <= 4; rail++) ctx.fillRect(wx - 3 + rail * (pw + 6) / 4, wy + ph - 10, 1.5, 9);
          }
        }
      }
    }
  }

  if (ground) {
    // Darker plinth, a centred door with a lit fanlight, shop windows and a
    // striped scalloped awning.
    a.fillStyle = 'rgba(0,0,0,0.20)'; a.fillRect(0, Y(FLOOR_H), cw, FLOOR_H * u);
    const doorW = 1.0 * u, doorH = 1.85 * u, dx = cw / 2 - doorW / 2, dy = ch - doorH;
    a.fillStyle = '#151b2a'; roundRect(a, dx, dy, doorW, doorH, 4); a.fill();
    a.strokeStyle = accent; a.lineWidth = 3; roundRect(a, dx, dy, doorW, doorH, 4); a.stroke();
    e.fillStyle = '#ffd9a0'; e.fillRect(dx + doorW * 0.2, dy + doorH * 0.12, doorW * 0.6, doorH * 0.28);
    const sw = dx - 0.55 * u, sh = 1.05 * u, sy = ch - 0.55 * u - sh;
    if (sw > 0.7 * u) {
      pane(0.3 * u, sy, sw, sh, true, 'ribbon');
      pane(dx + doorW + 0.25 * u, sy, sw, sh, true, 'ribbon');
    }
    const ay = Y(FLOOR_H + 0.05), ah = 0.42 * u, stripe = 0.5 * u, sc = 0.34 * u;
    if (awning === 'tin') {
      // A corrugated iron canopy on a dark bracket line.
      a.fillStyle = '#b9bfc4'; a.fillRect(0, ay, cw, ah);
      for (let x0 = 0; x0 < cw; x0 += 0.16 * u) { a.fillStyle = 'rgba(0,0,0,0.18)'; a.fillRect(x0, ay, 0.06 * u, ah); a.fillStyle = 'rgba(255,255,255,0.35)'; a.fillRect(x0 + 0.08 * u, ay, 0.04 * u, ah); }
      a.fillStyle = 'rgba(0,0,0,0.4)'; a.fillRect(0, ay + ah - 2, cw, 3);
    } else if (awning === 'wood') {
      // Plank eave with the shop timbers showing through.
      a.fillStyle = '#8a5a34'; a.fillRect(0, ay, cw, ah);
      a.fillStyle = 'rgba(0,0,0,0.25)'; for (let x0 = 0; x0 < cw; x0 += 0.45 * u) a.fillRect(x0, ay, 2, ah);
      a.fillStyle = 'rgba(255,220,170,0.25)'; a.fillRect(0, ay, cw, 2);
    } else if (awning === 'canvas') {
      // Plain canvas with a dark hem and a scalloped valance in the accent.
      a.fillStyle = accent; a.fillRect(0, ay, cw, ah);
      a.fillStyle = 'rgba(0,0,0,0.2)'; a.fillRect(0, ay + ah - 0.08 * u, cw, 0.08 * u);
      a.fillStyle = 'rgba(255,255,255,0.18)'; a.fillRect(0, ay, cw, 0.1 * u);
      a.fillStyle = accent;
      for (let x0 = sc / 2; x0 < cw; x0 += sc) { a.beginPath(); a.arc(x0, ay + ah, sc / 2, 0, Math.PI); a.fill(); }
    } else {
      a.fillStyle = accent; a.fillRect(0, ay, cw, ah);
      a.fillStyle = 'rgba(255,255,255,0.4)';
      for (let x0 = 0; x0 < cw; x0 += stripe * 2) a.fillRect(x0, ay, stripe, ah);
      a.fillStyle = accent;
      for (let x0 = sc / 2; x0 < cw; x0 += sc) { a.beginPath(); a.arc(x0, ay + ah, sc / 2, 0, Math.PI); a.fill(); }
    }
  }

  if (!facadeAniso) facadeAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  const map = new THREE.CanvasTexture(alb), emissiveMap = new THREE.CanvasTexture(emi);
  for (const t of [map, emissiveMap]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = facadeAniso; }
  return { map, emissiveMap };
}

// ---------------------------------------------------------------------------
// Roof textures: small tileable canvases, one per kind, shared by every roof cap
// of the island (flagged shared, so a building's disposal leaves them alone).
// They are pale so the cap's own colour (pal.roof) shows through the map.
// ---------------------------------------------------------------------------
const roofTextures = new Map();
export const ROOF_TILE = 2.2; // world units per texture repeat
export function roofTexture(kind) {
  if (!kind) return null;
  if (roofTextures.has(kind)) return roofTextures.get(kind);
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, S, S);
  if (kind === 'tiles') {
    // Terracotta barrel tiles: staggered rows of half-rounds, shadowed underneath.
    const tw = S / 6, th = S / 5;
    for (let row = -1; row <= 5; row++) for (let col = -1; col <= 6; col++) {
      const x = col * tw + (row % 2 ? tw / 2 : 0), y = row * th;
      g.fillStyle = '#9a9a9a'; g.fillRect(x, y, tw, th);
      const sh = g.createLinearGradient(x, 0, x + tw, 0);
      sh.addColorStop(0, '#bdbdbd'); sh.addColorStop(0.5, '#f4f4f4'); sh.addColorStop(1, '#8e8e8e');
      g.fillStyle = sh; g.beginPath(); g.arc(x + tw / 2, y + th, tw / 2, Math.PI, 0); g.lineTo(x + tw, y); g.lineTo(x, y); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y + th - 3, tw, 3);
    }
  } else if (kind === 'slate') {
    // Slate: staggered stone rectangles with dark joints and varied tone.
    const tw = S / 4, th = S / 6;
    for (let row = -1; row <= 6; row++) for (let col = -1; col <= 4; col++) {
      const x = col * tw + (row % 2 ? tw / 2 : 0), y = row * th, v = 190 + ((row * 7 + col * 13) % 5) * 14;
      g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(x + 1, y + 1, tw - 2, th - 2);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + th - 2, tw, 2);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 1, y + 1, tw - 2, 1.5);
    }
  } else if (kind === 'tin') {
    // Corrugated iron: vertical ridges lit on one flank, with a faint rust bloom.
    for (let x = 0; x < S; x += 8) {
      const rib = g.createLinearGradient(x, 0, x + 8, 0);
      rib.addColorStop(0, '#9c9c9c'); rib.addColorStop(0.4, '#f6f6f6'); rib.addColorStop(1, '#8a8a8a');
      g.fillStyle = rib; g.fillRect(x, 0, 8, S);
    }
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (const y of [0, S / 2]) g.fillRect(0, y, S, 2); // sheet overlaps
    for (let n = 0; n < 6; n++) { g.fillStyle = 'rgba(120,70,30,0.12)'; g.beginPath(); g.arc((n * 41) % S, (n * 67) % S, 8 + n * 2, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'gravel') {
    for (let n = 0; n < 700; n++) { const v = 150 + (n * 37) % 90; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect((n * 53) % S, (n * 97) % S, 2, 2); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = facadeAniso || 4;
  tex.userData.shared = true;
  roofTextures.set(kind, tex);
  return tex;
}
// Scale a geometry's UVs so a ROOF_TILE-sized texture repeats to its world size.
export function tileUv(geometry, w, d) {
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / ROOF_TILE, uv.getY(i) * d / ROOF_TILE);
  return geometry;
}
