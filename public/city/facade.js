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
export const WIN_STYLES = ['square', 'arch', 'ribbon'];
const _hsl = { h: 0, s: 0, l: 0 };
export function buildingPalette(hex) {
  new THREE.Color(hex).getHSL(_hsl);
  const grey = _hsl.s < 0.12;
  const sat = grey ? _hsl.s : THREE.MathUtils.clamp(_hsl.s, 0.4, 0.62);
  const lig = THREE.MathUtils.clamp(_hsl.l, 0.58, 0.7);
  return {
    wall: new THREE.Color().setHSL(_hsl.h, sat, lig),
    roof: new THREE.Color().setHSL(_hsl.h, Math.min(1, sat + 0.08), lig * 0.5),
    accent: new THREE.Color().setHSL((_hsl.h + 0.5) % 1, grey ? 0.5 : 0.7, 0.56),
  };
}
const hexCss = (c) => '#' + c.getHexString();
let facadeAniso = 0;
export function paintFacade(rnd, pal, w, h, { ground = false, style = 'square', litProb = 0.65 } = {}) {
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

  const frame = 'rgba(0,0,0,0.38)', paneDark = '#26324c';
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
    if (kind === 'square') { // mullion cross in the wall colour
      a.fillStyle = wall; e.fillStyle = '#000';
      for (const ctx of [a, e]) { ctx.fillRect(x0 + pw / 2 - 1.5, y0, 3, ph); ctx.fillRect(x0, y0 + ph / 2 - 1.5, pw, 3); }
    }
    if (lit && rnd() < 0.3) { // someone standing in a lit window
      e.fillStyle = 'rgba(0,0,0,0.6)';
      e.fillRect(x0 + pw * (0.3 + rnd() * 0.3), y0 + ph * 0.45, pw * 0.22, ph * 0.5);
    }
  };

  const cols = Math.max(1, Math.round(w / 1.55)), cellW = cw / cols;
  for (let fl = ground ? 1 : 0; fl < floors; fl++) {
    const base = fl * FLOOR_H;
    if (style === 'ribbon') {
      if (base + 1.75 > h - 0.35) break;
      const ph = 1.0 * u, y0 = Y(base + 1.75);
      pane(0.25 * u, y0, cw - 0.5 * u, ph, rnd() < litProb, 'ribbon');
      a.fillStyle = frame; e.fillStyle = '#000';
      for (let c = 1; c < cols; c++) { a.fillRect(c * cellW - 1, y0, 2, ph); e.fillRect(c * cellW - 1, y0, 2, ph); }
    } else {
      const pw = Math.min(cellW * 0.58, 1.0 * u), ph = (style === 'arch' ? 1.45 : 1.15) * u;
      if (base + 0.65 + ph / u > h - 0.35) break;
      for (let c = 0; c < cols; c++) {
        pane(c * cellW + (cellW - pw) / 2, Y(base + 0.65) - ph, pw, ph, rnd() < litProb, style);
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
    a.fillStyle = accent; a.fillRect(0, ay, cw, ah);
    a.fillStyle = 'rgba(255,255,255,0.4)';
    for (let x0 = 0; x0 < cw; x0 += stripe * 2) a.fillRect(x0, ay, stripe, ah);
    a.fillStyle = accent;
    for (let x0 = sc / 2; x0 < cw; x0 += sc) { a.beginPath(); a.arc(x0, ay + ah, sc / 2, 0, Math.PI); a.fill(); }
  }

  if (!facadeAniso) facadeAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  const map = new THREE.CanvasTexture(alb), emissiveMap = new THREE.CanvasTexture(emi);
  for (const t of [map, emissiveMap]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = facadeAniso; }
  return { map, emissiveMap };
}
