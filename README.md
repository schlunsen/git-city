# Git City

Turn any GitHub profile into an interactive cartoon city.

Every public repository becomes a building: height and footprint scale with
stars, the facade colour follows the primary language, and repositories are
clustered into language districts around a central plaza. Load a profile and
the last 90 days of public activity play back Gource-style — the developer's
avatar flies from building to building, beaming pushes, pull requests, issues
and stars onto the skyline while a timeline clock and activity feed keep score.

**Live:** https://schlunsen.github.io/git-city/

## Features

- Cel-shaded Three.js scene with ink outlines, painted facades, tiered towers
  and hip roofs, rooftop decals, and vacant-lot decals (parks, courts, sites)
- A hand-drawn world around the block: grass island in toon water, painted
  hills on the horizon, paper-cutout trees, houses, street furniture, hot-air
  balloons, a lighthouse, a windmill and a ferris wheel
- Day / night follows your local clock (or pick day, night, or a 60-second
  cycle); rain and snow; bloom, grade and grain post-processing
- Gource-style activity playback with scrubbing and speed control, a
  cinematic tour, and click-to-inspect repository panels
- Zero build step: vanilla ES modules, Three.js from a CDN via an import map

## Running locally

```sh
node server.mjs            # http://localhost:8000
node --test tests/         # unit tests for layout + timeline math
```

Any static file server works — the app is just the `public/` directory.

## Featured developers and the GitHub rate limit

The app calls the GitHub REST API directly from the browser, which is limited
to 60 unauthenticated requests per hour per IP. The featured profiles in the
top bar ship with a snapshot in `public/fixtures/` that a GitHub Actions
workflow refreshes daily; the app prefers a fresh snapshot, falls back to the
live API, and falls back to the snapshot again if the API is rate-limited.
Open the page with `?demo=1` to force snapshot mode.

```sh
GITHUB_TOKEN=$(gh auth token) node scripts/scrape.mjs          # refresh all
node scripts/scrape.mjs torvalds antfu                          # a subset
```

## Artwork

The cutout sprites, tiles and backdrop in `public/assets/` were generated
with an image model, chroma-keyed and split into sprites. They are part of this
repository and covered by its license.

## License

MIT — see [LICENSE](LICENSE).
