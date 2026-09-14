// Solid architectural details, merged into one coloured mesh per building.
// The repository's box bodies remain the picking and sign-placement surfaces.
import * as THREE from 'three';
import { box, mergeParts, noRaycast, toonMat } from './toon.js';

export const ARCHITECTURES = [
  { name: 'deco', windows: 'slender' },
  { name: 'garden', windows: 'ribbon' },
  { name: 'balconies', windows: 'balcony' },
  { name: 'glass', windows: 'glass' },
  { name: 'heritage', windows: 'arch' },
  { name: 'loft', windows: 'square' },
];

// theme: the island's building theme (themes.js). Its `details` list adds the
// pieces that make a town read as adobe, chalet, colonial or brick from a
// distance: beam ends and ladders, deep eaves and rails, arcades, fire escapes.
export function architectureDetails(group, family, pal, rnd, theme = null) {
  const parts = [];
  const stone = pal.wall.clone().lerp(new THREE.Color(0xfff0d6), 0.65).getHex();
  const dark = 0x263a48, bronze = 0xd8ad68, green = 0x548449, timber = 0x7d4f2f, plank = 0xa1714a, white = 0xf4efe4;
  const has = (k) => !!theme?.details?.includes(k);
  const add = (w, h, d, x, y, z, color = stone) => parts.push([box(w, h, d, x, y, z), color]);
  const ring = (w, y, x, z, thickness = 0.16, height = 0.2, color = stone) => {
    for (const sign of [-1, 1]) {
      add(w, height, thickness, x, y, z + sign * (w - thickness) / 2, color);
      add(thickness, height, w - thickness * 2, x + sign * (w - thickness) / 2, y, z, color);
    }
  };
  const planter = (x, y, z, w = 0.85) => {
    add(w, 0.3, 0.55, x, y + 0.15, z, 0xb68562);
    add(w * 0.95, 0.42, 0.52, x, y + 0.5, z, green);
  };
  return {
    tier({ x, z, y, w, h, nextW, rotation = 0, roofHeight = 0.7, terraces = false }) {
      const start = parts.length;
      if (family === 'deco') {
        // Full-height fluted piers and gold shoulder bands.
        for (const s of [-1, 1]) for (const q of [-1, 1]) {
          add(0.24, h, 0.24, x + s * (w / 2 - 0.04), y + h / 2, z + q * (w / 2 - 0.04));
        }
        ring(w + 0.16, y + h - 0.3, x, z, 0.16, 0.18, bronze);
      } else if (family === 'balconies') {
        // Deep wraparound slabs and inset dark rails: visible in silhouette.
        for (let floor = 2.6; floor < h - 1; floor += 2.6) {
          ring(w + 0.65, y + floor + 0.12, x, z, 0.48, 0.16);
          ring(w + 0.57, y + floor + 0.65, x, z, 0.07, 0.08, dark);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            add(0.07, 0.53, 0.07, x + sx * (w + 0.5) / 2, y + floor + 0.38, z + sz * (w + 0.5) / 2, dark);
          }
          if (rnd() > 0.55) planter(x + w * 0.23, y + floor + 0.2, z + w / 2 + 0.1, Math.min(0.85, w * 0.3));
        }
      } else if (family === 'glass') {
        // Large diagonal braces on each face, unlike the small window grid.
        const bottom = y + Math.min(3.1, h * 0.2), span = h - (bottom - y) - 0.7;
        if (span > 2) {
          const bays = Math.max(1, Math.round(span / 7));
          for (let b = 0; b < bays; b++) for (let side = 0; side < 4; side++) {
            const rise = span / bays, run = w * 0.83;
            const g = box(0.13, Math.hypot(rise, run), 0.13);
            g.rotateZ((b % 2 ? 1 : -1) * Math.atan2(run, rise));
            g.translate(0, bottom + (b + 0.5) * rise, w / 2 + 0.06);
            g.rotateY(side * Math.PI / 2).translate(x, 0, z);
            parts.push([g, stone]);
          }
        }
      } else if (family === 'heritage' || family === 'loft') {
        for (let floor = 5.2; floor < h - 0.7; floor += 5.2) ring(w + 0.18, y + floor, x, z, 0.16, 0.16);
        ring(w + 0.35, y + h - 0.2, x, z, 0.26, 0.3);
      }
      // Broad planted setbacks turn the garden family into vertical parks.
      if (family === 'garden' && nextW && w - nextW > 0.6) {
        ring(w + 0.1, y + h + roofHeight + 0.18, x, z, 0.12, 0.34);
        for (const s of [-1, 1]) {
          planter(x + s * w * 0.29, y + h + roofHeight, z + w / 2 - 0.35, w * 0.3);
          if (terraces) planter(x + w / 2 - 0.35, y + h + roofHeight, z + s * w * 0.29, w * 0.3);
          else planter(x + s * w * 0.29, y + h + roofHeight, z - w / 2 + 0.35, w * 0.3);
        }
      }
      const ground = y < 0.01, top = !nextW;
      if (has('vigas')) {
        // Adobe: rows of round beam ends poke out under every floor, a low
        // rounded parapet crowns the top tier, and a ladder leans on a small house.
        for (let floor = ground ? 5.2 : 2.6; floor < h + 0.1; floor += 2.6) for (let side = 0; side < 4; side++) {
          for (let t = -0.5 + 0.35 / w; t < 0.5; t += 0.7 / w) {
            const g = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6).rotateX(Math.PI / 2).translate(t * w, y + floor - 0.35, w / 2 + 0.2);
            g.rotateY(side * Math.PI / 2).translate(x, 0, z);
            parts.push([g, timber]);
          }
        }
        if (top) ring(w + 0.1, y + h + roofHeight + 0.2, x, z, 0.28, 0.42, pal.wall.getHex());
        if (ground && h < 12 && rnd() < 0.5) {
          const lh = Math.min(h - 0.4, 5.5), lx = x + w * 0.3, lz = z + w / 2 + 0.28;
          for (const s of [-0.28, 0.28]) parts.push([box(0.09, lh, 0.09, lx + s, y + lh / 2, lz).rotateX(-0.1), plank]);
          for (let r = 0.5; r < lh - 0.3; r += 0.55) parts.push([box(0.62, 0.07, 0.07, lx, y + r, lz - r * 0.1), plank]);
        }
      }
      if (has('eaves')) {
        // Chalet: a deep dark eave slab on every tier, a timber balcony with a
        // rail across the front at first-floor height, and a log pile by the door.
        ring(w + 1.0, y + h + roofHeight + 0.1, x, z, 0.5, 0.2, 0x3a4249);
        if (ground && h >= 5) {
          const by = y + 3.35, bw = w * 0.9; // above the shop fascia
          add(bw, 0.14, 0.9, x, by, z + w / 2 + 0.4, plank);
          add(bw, 0.06, 0.06, x, by + 0.95, z + w / 2 + 0.82, timber);
          for (let t = -0.5; t <= 0.5; t += 1 / Math.max(2, Math.round(bw / 0.5))) add(0.06, 0.9, 0.06, x + t * bw, by + 0.5, z + w / 2 + 0.82, timber);
          for (const s of [-1, 1]) add(0.16, by - y, 0.16, x + s * (bw / 2 - 0.1), y + (by - y) / 2, z + w / 2 + 0.75, timber);
        }
        if (ground && rnd() < 0.6) for (let n = 0; n < 6; n++) {
          const g = new THREE.CylinderGeometry(0.14, 0.14, 0.8, 6).rotateX(Math.PI / 2)
            .translate(x - w / 2 - 0.35, y + 0.14 + (n % 3) * 0.28, z + (n < 3 ? -0.15 : 0.15) + w * 0.2);
          parts.push([g, n % 2 ? plank : timber]);
        }
      }
      if (has('arcade') && ground && h >= 5) {
        // Colonial: a veranda on slim white columns wraps the ground floor, with a
        // balustrade around its tin roof.
        const vw = w + 1.6, vy = y + 3.35; // the veranda roof clears the shop fascia
        ring(vw, vy, x, z, 0.85, 0.12, white);
        ring(vw - 0.1, vy + 0.4, x, z, 0.06, 0.06, white);
        const n = Math.max(2, Math.round(vw / 1.6));
        for (let i = 0; i <= n; i++) for (const side of [-1, 1]) {
          const t = -vw / 2 + 0.2 + (i / n) * (vw - 0.4);
          add(0.13, vy - y, 0.13, x + t, y + (vy - y) / 2, z + side * (vw / 2 - 0.2), white);
          add(0.13, vy - y, 0.13, x + side * (vw / 2 - 0.2), y + (vy - y) / 2, z + t, white);
          for (let b = 0.25; b < 1.4; b += 0.25) { add(0.06, 0.34, 0.06, x + t + b - 0.7, vy + 0.23, z + side * (vw / 2 - 0.2), white); }
        }
      }
      if (has('fireEscape') && h >= 7) {
        // Brick: iron landings and zigzag stairs down one side face.
        const fx = x - w / 2 - 0.45;
        for (let floor = ground ? 5.2 : 2.6, k = 0; floor < h - 0.5; floor += 2.6, k++) {
          add(0.8, 0.06, Math.min(w * 0.7, 3.4), fx, y + floor, z, dark);
          add(0.03, 0.85, Math.min(w * 0.7, 3.4), fx - 0.38, y + floor + 0.45, z, dark);
          const run = Math.min(w * 0.6, 2.8), st = box(0.55, 0.05, Math.hypot(2.6, run)).rotateX((k % 2 ? -1 : 1) * Math.atan2(2.6, run)).translate(fx, y + floor + 1.3, z);
          parts.push([st, dark]);
        }
      }
      if (rotation) for (let n = start; n < parts.length; n++) parts[n][0].translate(-x, 0, -z).rotateY(rotation).translate(x, 0, z);
    },
    roof({ x, z, y, w, custom }) {
      if (custom) return;
      if (family === 'deco') {
        // A stepped lantern and needle give even a narrow tower a clear crown.
        for (let n = 0; n < 3; n++) {
          const size = w * (0.76 - n * 0.17);
          add(size, 0.65, size, x, y + 0.325 + n * 0.65, z, n % 2 ? bronze : stone);
        }
        parts.push([new THREE.ConeGeometry(w * 0.16, 2.5, 4).rotateY(Math.PI / 4).translate(x, y + 3.2, z), bronze]);
      } else if (family === 'garden') {
        ring(w, y + 0.3, x, z, 0.15, 0.5);
        for (const s of [-1, 1]) planter(x + s * w * 0.28, y, z - w * 0.3, w * 0.34);
        // Timber pergola with an open slatted canopy.
        const pw = w * 0.54, pz = w * 0.22;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.1, 1.5, 0.1, x + sx * pw / 2, y + 0.75, z + sz * pz, 0xa9784d);
        for (let n = 0; n < 5; n++) add(0.12, 0.12, pz * 2 + 0.3, x - pw / 2 + n * pw / 4, y + 1.5, z, 0xc19765);
      } else if (family === 'heritage') {
        // Sloping mansard roof, with a flat central ridge for roof signage.
        const g = new THREE.CylinderGeometry(w * 0.27, w * 0.72, 1.6, 4).rotateY(Math.PI / 4).translate(x, y + 0.8, z);
        parts.push([g, 0x3a505f]);
        add(w * 0.42, 0.18, w * 0.42, x, y + 1.66, z, bronze);
        add(0.45, 1.7, 0.45, x - w * 0.3, y + 0.85, z - w * 0.2, 0xac7658);
      } else if (family === 'loft') {
        ring(w, y + 0.3, x, z, 0.18, 0.55);
        // Three tilted skylights, with pale structural frames.
        for (let n = 0; n < 3; n++) {
          const xx = x + (n - 1) * w * 0.24;
          const frame = box(w * 0.2, 0.14, w * 0.55).rotateX(-0.3).translate(xx, y + 0.4, z);
          const pane = box(w * 0.16, 0.15, w * 0.48).rotateX(-0.3).translate(xx, y + 0.46, z);
          parts.push([frame, stone], [pane, 0x65b1c0]);
        }
      } else ring(w, y + 0.2, x, z, 0.12, 0.3);
    },
    finish() {
      if (!parts.length) return;
      const geometry = mergeParts(parts, true);
      // These details belong only to this building and must be freed on rebuild.
      geometry.userData.shared = false;
      const mesh = new THREE.Mesh(geometry, toonMat({ vertexColors: true }));
      mesh.name = 'architecture-details';
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.raycast = noRaycast;
      group.add(mesh);
    },
  };
}
