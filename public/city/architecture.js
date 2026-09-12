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

export function architectureDetails(group, family, pal, rnd) {
  const parts = [];
  const stone = pal.wall.clone().lerp(new THREE.Color(0xfff0d6), 0.65).getHex();
  const dark = 0x263a48, bronze = 0xd8ad68, green = 0x548449;
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
