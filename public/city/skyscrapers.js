// Tall-building massing. Every plan has square, unrotated first/last sections
// for shop and roof signs, stays inside its lot, and tops out at the star height.
export function skyscraperPlan(h, f, variant) {
  const section = (base, height, width, extra = {}) => ({ base: h * base, h: h * height, f: f * width, x: 0, z: 0, ...extra });
  const podium = section(0, 0.12, 1);
  if (variant === 1 && f >= 4) {
    return { name: 'skybridge', family: 'glass', tiers: [podium,
      section(0.12, 0.7, 0.36, { x: -f * 0.3 }),
      section(0.66, 0.055, 0.6, { depth: f * 0.25, bare: true }),
      section(0.12, 0.88, 0.36, { x: f * 0.3 }),
    ] };
  }
  if (variant === 2) {
    return { name: 'spiral', family: 'balconies', tiers: [podium,
      ...Array.from({ length: 7 }, (_, n) => section(0.12 + n * 0.12, 0.12, 0.66 - n * 0.025, { rotation: n * Math.PI / 18 })),
      section(0.96, 0.04, 0.4),
    ] };
  }
  if (variant === 3) {
    return { name: 'pinnacle', family: 'deco', tiers: [
      section(0, 0.46, 1), section(0.46, 0.23, 0.76),
      section(0.69, 0.15, 0.54), section(0.84, 0.10, 0.36), section(0.94, 0.06, 0.25),
    ] };
  }
  if (variant === 4) {
    return { name: 'terraces', family: 'garden', tiers: Array.from({ length: 5 }, (_, n) =>
      section(n * 0.2, 0.2, 1 - n * 0.16, { x: -f * n * 0.065, z: -f * n * 0.065 })) };
  }
  return { name: 'obelisk', family: 'glass', tiers: [podium,
    section(0.12, 0.8, 0.94, { shape: 'octagon', taper: 0.46, cap: false }),
    section(0.92, 0.08, 0.30),
  ] };
}
