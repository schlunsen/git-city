/*
 * Gitilla — spray-painted graffiti for building walls (city.json /
 * building.json "graffiti"). Paints validated text onto a transparent canvas
 * with canvas fillText / strokeText only: an outline, the fill, overspray and
 * a few drips. Deterministic per seed, so a building always wears the same
 * piece. Shared by the 3D walls (city/buildings.js) and the Customize preview.
 */

export const GRAFFITI_W = 512, GRAFFITI_H = 256;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const FONTS = {
  tag: (px) => `italic 900 ${px}px "Marker Felt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`,
  bubble: (px) => `900 ${px}px "Arial Rounded MT Bold", "Nunito", ui-rounded, "Trebuchet MS", system-ui, sans-serif`,
  stencil: (px) => `700 ${px}px Impact, "Haettenschweiler", "Arial Narrow Bold", "Arial Black", sans-serif`,
};
const DEFAULT_COLOR = { tag: '#ff5ab4', bubble: '#64dedb', stencil: '#1a2233' };

// Split into at most two lines of roughly equal length.
function lines(text) {
  const words = text.split(' ');
  if (words.length < 2 || text.length < 14) return [text];
  let best = [text], score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const s = Math.max(a.length, b.length);
    if (s < score) { score = s; best = [a, b]; }
  }
  return best;
}

/**
 * @param {HTMLCanvasElement} canvas  resized to GRAFFITI_W x GRAFFITI_H
 * @param {{ text: string, color?: string, style?: 'tag'|'bubble'|'stencil' }} g  validated graffiti
 * @param {string} [seedKey]  e.g. the repo name, for the drips and overspray
 */
export function paintGraffiti(canvas, g, seedKey = '') {
  canvas.width = GRAFFITI_W; canvas.height = GRAFFITI_H;
  const ctx = canvas.getContext('2d');
  const style = FONTS[g.style] ? g.style : 'tag';
  const color = g.color || DEFAULT_COLOR[style];
  const text = style === 'stencil' ? String(g.text).toUpperCase() : String(g.text);
  const rnd = rng(hashStr(`${seedKey}|${text}|${style}`));
  const rows = lines(text);
  const W = GRAFFITI_W, H = GRAFFITI_H, pad = 34;
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // Fit the longest line.
  let px = rows.length > 1 ? 92 : 132;
  const font = FONTS[style];
  ctx.font = font(px);
  const widest = () => Math.max(...rows.map((r) => ctx.measureText(r).width));
  while (widest() > W - pad * 2 && px > 18) { px -= 3; ctx.font = font(px); }
  const lh = px * 1.02, y0 = H / 2 - ((rows.length - 1) * lh) / 2;

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(style === 'tag' ? -0.08 : style === 'bubble' ? -0.03 : 0);
  ctx.translate(-W / 2, -H / 2);

  // Overspray: a soft haze of dots around the piece.
  const bw = Math.min(W - 20, widest() + 40), bh = rows.length * lh + 30;
  ctx.fillStyle = color;
  for (let i = 0; i < 260; i++) {
    const x = W / 2 + (rnd() - 0.5) * bw * (0.9 + rnd() * 0.3), y = H / 2 + (rnd() - 0.5) * bh * (0.9 + rnd() * 0.4);
    ctx.globalAlpha = 0.05 + rnd() * 0.18;
    ctx.beginPath(); ctx.arc(x, y, 0.8 + rnd() * 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  rows.forEach((row, i) => {
    const y = y0 + i * lh;
    if (style === 'bubble') {
      ctx.lineWidth = px * 0.34; ctx.strokeStyle = '#1a2233';
      ctx.strokeText(row, W / 2 + px * 0.06, y + px * 0.07);   // drop shadow / 3D edge
      ctx.strokeText(row, W / 2, y);
      ctx.lineWidth = px * 0.16; ctx.strokeStyle = '#fdf8ec'; ctx.strokeText(row, W / 2, y);
      ctx.fillStyle = color; ctx.fillText(row, W / 2, y);
    } else if (style === 'stencil') {
      ctx.fillStyle = color; ctx.globalAlpha = 0.92; ctx.fillText(row, W / 2, y);
      ctx.globalAlpha = 1;
      // Stencil bridges: thin gaps through every letter.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (const f of [-0.18, 0.2]) ctx.fillRect(0, y + f * px - px * 0.035, W, px * 0.07);
      ctx.restore();
    } else {
      ctx.lineWidth = px * 0.2; ctx.strokeStyle = '#1a2233'; ctx.strokeText(row, W / 2, y);
      ctx.fillStyle = color; ctx.fillText(row, W / 2, y);
      ctx.lineWidth = Math.max(2, px * 0.035); ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.strokeText(row, W / 2 - px * 0.03, y - px * 0.04); // a quick highlight stroke
    }
  });

  // Drips from the bottom of the last line.
  const last = rows[rows.length - 1], lw = ctx.measureText(last).width;
  const yb = y0 + (rows.length - 1) * lh + px * 0.36;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round';
  const drips = style === 'stencil' ? 3 : 6;
  for (let i = 0; i < drips; i++) {
    const x = W / 2 + (rnd() - 0.5) * lw * 0.9, len = 10 + rnd() * (style === 'bubble' ? 26 : 44);
    ctx.lineWidth = 2 + rnd() * 3;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(x, yb - 6); ctx.lineTo(x, Math.min(H - 6, yb + len)); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, Math.min(H - 6, yb + len), ctx.lineWidth * 0.9, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  return canvas;
}
