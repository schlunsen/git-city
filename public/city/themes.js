/*
 * Building themes: how the city block is built, chosen to suit the island the
 * way BIOME_HORIZONS (world.js) picks the far ridge. `metro` is the original
 * glass-and-brick look; the others re-tint the facades, swap the wall
 * treatment, weight the architecture families and change the roofs, so a
 * savanna town is sun-baked adobe and an alpine one is timber chalets.
 * Height, footprint and the language hue still come from the repository.
 */
export const BUILDING_THEMES = Object.freeze({
  metro: {
    label: 'Metro (glass and brick)',
    wall: 'auto', awning: 'stripes', hip: 0.55, props: { waterTower: true, ac: true, mast: true },
  },
  adobe: {
    label: 'Adobe (sun-baked)',
    tint: 0xe0b078, tintK: 0.58, sat: [0.22, 0.42], lig: [0.6, 0.72],
    roofColor: 0xb26b4c, roofTex: 'tiles', capOver: 0.12, wall: 'plaster', panes: '#3a2c26', shutters: '#6f4a38',
    awning: 'canvas', families: ['heritage', 'loft', 'loft', 'balconies'], hip: 0, details: ['vigas'],
    props: { waterTower: false, ac: false, mast: false, dish: true },
  },
  chalet: {
    label: 'Chalet (timber)',
    tint: 0x7c5637, tintK: 0.5, sat: [0.3, 0.5], lig: [0.5, 0.62],
    roofColor: 0x46525c, roofTex: 'slate', wall: 'timber', panes: '#26303c', shutters: '#3d6a49',
    awning: 'wood', families: ['balconies', 'balconies', 'heritage', 'loft'], hip: 0.9,
    gable: { spread: 1.35, rise: 1.25, ridge: true }, details: ['eaves'], props: { waterTower: false, ac: false, mast: true, chimney: true },
  },
  colonial: {
    label: 'Colonial (whitewash and tin)',
    tint: 0xfff2dc, tintK: 0.6, sat: [0.3, 0.55], lig: [0.7, 0.8],
    roofColor: 0xc9584b, roofTex: 'tin', wall: 'clapboard', panes: '#2c4658', shutters: '#3b7f87',
    awning: 'tin', families: ['garden', 'balconies', 'heritage', 'glass'], hip: 0.55,
    gable: { spread: 1.15, rise: 0.85 }, details: ['arcade'], props: { waterTower: true, ac: false, mast: false },
  },
  brick: {
    label: 'Brick (red-brick lofts)',
    tint: 0xa3503f, tintK: 0.5, sat: [0.35, 0.55], lig: [0.5, 0.62],
    roofColor: 0x4b4139, roofTex: 'gravel', wall: 'brick', panes: '#26324c',
    awning: 'stripes', families: ['loft', 'loft', 'heritage', 'deco'], hip: 0.3, details: ['fireEscape'],
    props: { waterTower: true, ac: true, mast: true },
  },
});
export const THEME_NAMES = Object.freeze(Object.keys(BUILDING_THEMES));

// Weighted pools per biome (repeats are weights), like BIOME_HORIZONS.
export const BIOME_THEMES = Object.freeze({
  meadow: Object.freeze(['metro', 'metro', 'brick']),
  alpine: Object.freeze(['chalet', 'chalet', 'brick']),
  tropical: Object.freeze(['colonial', 'colonial', 'metro']),
  savanna: Object.freeze(['adobe', 'adobe', 'colonial']),
  lakeland: Object.freeze(['brick', 'chalet', 'metro']),
});

const named = (k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(BUILDING_THEMES, k) ? k : null);

// The theme for an island: ?buildings= to preview, then city.json island.buildings,
// then a seeded draw from the biome's pool (its own stream, so it never shifts
// the island's other draws).
export function pickBuildingTheme(traits, cfg = null, search = globalThis.location?.search || '') {
  const q = new URLSearchParams(search);
  const pool = BIOME_THEMES[traits?.biome] || BIOME_THEMES.meadow;
  let x = ((traits?.seed ?? 0) ^ 0x7b1d) >>> 0 || 1;
  x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; // one xorshift step
  const name = named(q.get('buildings')) || named(cfg?.island?.buildings) || pool[x % pool.length];
  return { name, ...BUILDING_THEMES[name] };
}
