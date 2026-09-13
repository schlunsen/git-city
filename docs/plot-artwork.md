# Non-building plots

The 16 ground textures in `public/assets/lots-0.png` through `lots-15.png`
share a warm stone perimeter, overhead composition and restrained green,
terracotta and blue palette. Each texture is rendered on a 4.7-unit square
inside the 5-unit lot. Tile footprints and colors do not vary randomly;
quarter-turn rotations and mirrors provide variation without skewing borders.

Plot modules and textures use a shared release version to refresh browser
caches. When replacing the set, bump `LOT_ASSET_VERSION` in `city/lots.js`,
the import-map URLs in `index.html`, and the import in `plots-preview.html`.
Recompute the import map's SHA-256 hash in the page's Content Security Policy
at the same time; `tests/plot-assets.test.mjs` checks that the map is permitted.

Open `http://localhost:8000/plots-preview.html` after starting `node server.mjs`
to review the full collection. The angled toggle approximates the ground-plane
view; use the city itself to review upright props and day/night lighting.

## Placement

`public/city/lots.js` plans the plot kinds and decorations. Illustrated activity
surfaces carry no extra props: garden beds, pond paths, sports markings, market
stalls and playground equipment must remain readable. This includes the anchor
of a garden square. Lawn plots allow one small tree on the left grassy area and
an optional low bush opposite it; both follow the texture's rotation and mirror.
Paved plots reserve their corners for a separated bench and lamp. The planner
keeps every prop base inside the plot and preserves deterministic layouts.

## Artwork source

Generated with the built-in imagegen tool. The exact prompt set is recorded in
`scripts/assets/plot-prompts.json`, indexed by the runtime sprite number.
Generated originals remain in the image tool's output directory; the project
copies are resized to 512 × 512 PNGs for runtime use. The previous asset versions
remain available in Git history.

All tiles must fill a square, use an overhead view, and keep objects inside the
stone border. Avoid chroma-key backgrounds, baked-in people and large trees.
Preserve the central third of the lawn as the walking corridor and the four
corners of the paved plaza as open prop slots when revising these assets.
