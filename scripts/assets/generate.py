#!/usr/bin/env python3
"""Generate Git City cutout art with an image model (Atlas Cloud's generateImage API).

Every sheet in public/assets/ came from one of the prompts in JOBS below: a
shared house STYLE, a subject, and a flat magenta background that key.py
turns into transparency. See docs/assets.md for the whole workflow.

usage:
  export ATLAS_API_KEY=...                                   # never commit it
  python3 scripts/assets/generate.py rockets                 # one or more named jobs
  python3 scripts/assets/generate.py --all                   # every job (regenerates the whole set)
  python3 scripts/assets/generate.py --name castle --aspect 16:9 \\
      --subject "Sprite sheet of 3 different cartoon castle landmark objects in a single row, side view, evenly spaced with clear gaps: ..."

Raw sheets land in scripts/assets/raw/ (git-ignored). Next step: key.py.
Each image costs a few cents (nano-banana is about $0.04 at 1k).
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = 'https://api.atlascloud.ai/api/v1/model/generateImage'
MODEL = 'google/nano-banana/text-to-image'
# Atlas sits behind Cloudflare, which rejects Python's default User-Agent (HTTP 403, "error code: 1010").
UA = 'git-city-assets/1.0'
RAW = Path(__file__).resolve().parent / 'raw'

# The house style. Keep it verbatim so new art matches the old.
STYLE = ('flat cel-shaded cartoon vector illustration, thick dark navy ink outlines, bold simple shapes, '
         'limited saturated palette, two-tone shading, no gradients, no text, no watermark, no signature')
MAG = 'isolated on a solid flat uniform magenta background (#FF00FF), nothing else in the background'

# name -> (aspect ratio, prompt). Sprite sheets ask for N objects "in a single
# row ... with clear gaps" so key.py can split them on the empty columns.
JOBS = {
    'clouds': ('16:9', f'Sprite sheet of 4 cartoon cumulus clouds in a single row, each a DIFFERENT shape and size (one wide, one tall, one small, one lumpy), white puffs with pale blue shadow underside, {STYLE}, {MAG}'),
    'trees': ('16:9', f'Sprite sheet of 5 different cartoon trees in a single row, side view, evenly spaced with clear gaps: round-canopy oak, tall slim poplar, pine tree, bushy maple, small blossoming cherry tree, green foliage with darker green shadow blobs, brown trunks, {STYLE}, {MAG}'),
    'bushes': ('16:9', f'Sprite sheet of 5 different small cartoon garden plants in a single row, side view, evenly spaced with clear gaps: round hedge bush, flower bed with red and yellow tulips, low shrub, tall grass clump, potted topiary, {STYLE}, {MAG}'),
    'props': ('16:9', f'Sprite sheet of 6 different cartoon city street objects in a single row, side view, evenly spaced with clear gaps: vintage street lamp post, wooden park bench, red fire hydrant, blue mailbox, hot-dog food cart with striped awning, bus stop sign, {STYLE}, {MAG}'),
    'houses': ('16:9', f'Sprite sheet of 6 different tiny cartoon suburban houses in a single row, side view, evenly spaced with clear gaps, varied roof colours (red, teal, orange, blue), chimneys, small windows, {STYLE}, {MAG}'),
    'hills': ('21:9', f'Wide panoramic backdrop strip of cartoon rolling green hills with a few distant blue-grey mountains behind, low horizon line, the hills silhouette forms the top edge, cel-shaded with 3 depth layers (dark green front, mid green, pale blue-green back), {STYLE}, everything above the hill silhouette is a solid flat uniform magenta (#FF00FF), the image must tile seamlessly left-to-right'),
    'grass': ('1:1', f'Seamless tileable top-down cartoon grass texture, two shades of green with small darker grass tufts and a few tiny flowers, {STYLE}, must tile seamlessly on all four edges, no border, no vignette'),
    'water': ('1:1', f'Seamless tileable top-down cartoon ocean water texture, bright turquoise blue with stylised white wave crests and curved highlight lines, {STYLE}, must tile seamlessly on all four edges, no border, no vignette'),
    'lots': ('1:1', f'2x2 grid of four square top-down orthographic cartoon city lot tiles, clear thin magenta gaps between tiles: 1) asphalt parking lot with white painted bays and a few parked cars, 2) small green park with a pond, paths and trees seen from directly above, 3) construction site with sand, a crane base and orange barriers, 4) basketball court with painted lines, {STYLE}, {MAG}'),
    'roofs': ('1:1', f'2x2 grid of four square top-down orthographic cartoon building roof tiles, clear thin magenta gaps between tiles: 1) grey gravel roof with HVAC units and pipes, 2) helipad with a big white H in a circle, 3) rooftop garden with planters and a wooden deck, 4) roof covered in blue solar panels, {STYLE}, {MAG}'),
    'landmarks': ('16:9', f'Sprite sheet of 4 different cartoon landmark objects in a single row, side view, evenly spaced with clear gaps: a hot air balloon, a small lighthouse, a windmill, a ferris wheel, {STYLE}, {MAG}'),
    # landmarks-4 (the launch pad) is the first sprite of this sheet.
    'rockets': ('16:9', f'Sprite sheet of 3 different cartoon rocket landmark objects in a single row, side view, evenly spaced with clear gaps: a retro red-and-white rocket on a small launch pad with a lattice gantry tower, a chunky teal rocket with round portholes standing on three fins on a concrete pad, a tall slim silver rocket with an orange nose cone beside a small launch tower, {STYLE}, {MAG}'),
    # Nature, round 2 (trees-5 .. trees-9 = TREE.WILLOW, BIRCH, ACACIA, BAOBAB, APPLE in world.js):
    'trees2': ('16:9', f'Sprite sheet of 5 different cartoon trees in a single row, side view, evenly spaced with clear gaps: a weeping willow with long drooping green branches, a white birch tree with a slim white trunk marked with black streaks and light green leaves, a flat-topped acacia umbrella tree with a dark brown trunk, a fat baobab tree with a thick grey-brown bottle-shaped trunk and a small green crown, an apple tree with a round green canopy dotted with red apples, foliage with darker green shadow blobs, no ground shadows, {STYLE}, {MAG}'),
    # ...and bushes-5 .. bushes-9 = BUSH.SUNFLOWERS, CACTUS, REEDS, STUMP, FERN:
    'plants2': ('16:9', f'Sprite sheet of 5 different small cartoon plants in a single row, side view, evenly spaced with clear gaps: a clump of three tall sunflowers, a round green cactus with a few yellow flowers, a tuft of tall green reeds with brown cattails, a mossy tree stump with small brown mushrooms, a lush green fern, plain plants with no faces, eyes or smiles, no ground shadows, {STYLE}, {MAG}'),
    # Scenery accents, in this order: props-fountain, props-dock, scenery-autumn-tree, scenery-rock-cluster
    # (key.py row ... --names props-fountain props-dock scenery-autumn-tree scenery-rock-cluster).
    # Street furniture already exists in the props sheet (lamp, bench, hydrant, mailbox): reuse it.
    'scenery_accents': ('16:9', f'Sprite sheet of 4 different cartoon outdoor objects in a single row, side view, evenly spaced with clear gaps: a round grey stone fountain with a wide basin and a small spout of water on top, a short wooden pier on wooden posts with a mooring post, an autumn tree with a full round canopy of orange and red leaves on a brown trunk, a cluster of three mossy grey boulders of different sizes, no ground shadows, {STYLE}, {MAG}'),
}


def generate(name, aspect, prompt, *, key, model=MODEL, resolution='1k', out=RAW):
    body = {'model': model, 'prompt': prompt, 'resolution': resolution, 'aspect_ratio': aspect,
            'output_format': 'png', 'enable_sync_mode': True}
    req = urllib.request.Request(API, data=json.dumps(body).encode(), headers={
        'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        return f'FAIL {name}: HTTP {e.code} {e.read()[:200]!r}'
    except Exception as e:  # network, timeout
        return f'FAIL {name}: {e!r}'
    data = d.get('data') or {}
    if data.get('status') != 'completed' or not data.get('outputs'):
        return f'FAIL {name}: {d.get("message") or data.get("error") or "no image returned"}'
    # outputs[0] is a provider-hosted URL that expires: download it now.
    img = urllib.request.urlopen(urllib.request.Request(data['outputs'][0], headers={'User-Agent': UA}), timeout=120).read()
    out.mkdir(parents=True, exist_ok=True)
    path = out / f'{name}.png'
    path.write_bytes(img)
    return f'OK   {name} -> {path} ({data.get("latency_ms")} ms, {data.get("model")})'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('jobs', nargs='*', help=f'named jobs: {", ".join(JOBS)}')
    ap.add_argument('--all', action='store_true', help='run every job')
    ap.add_argument('--name', help='ad-hoc job name (with --subject)')
    ap.add_argument('--subject', help='ad-hoc subject; the house STYLE and magenta background are appended')
    ap.add_argument('--aspect', default='16:9', help='aspect ratio for --subject (1:1, 16:9, 21:9, ...)')
    ap.add_argument('--model', default=MODEL, help=f'Atlas model id (default {MODEL})')
    ap.add_argument('--resolution', default='1k', choices=['1k', '2k', '4k'])
    ap.add_argument('--out', type=Path, default=RAW, help='where raw sheets go (default scripts/assets/raw)')
    a = ap.parse_args()

    key = os.environ.get('ATLAS_API_KEY', '').strip()
    if not key:
        sys.exit('Set ATLAS_API_KEY (an Atlas Cloud API key). It is only read from the environment.')
    todo = {}
    if a.subject:
        if not a.name:
            sys.exit('--subject needs --name')
        todo[a.name] = (a.aspect, f'{a.subject}, {STYLE}, {MAG}')
    for n in (JOBS if a.all else a.jobs):
        if n not in JOBS:
            sys.exit(f'unknown job {n!r}; known: {", ".join(JOBS)}')
        todo[n] = JOBS[n]
    if not todo:
        ap.print_help()
        return
    with cf.ThreadPoolExecutor(4) as ex:
        results = list(ex.map(lambda item: generate(item[0], *item[1], key=key, model=a.model, resolution=a.resolution, out=a.out), todo.items()))
    for line in results:
        print(line)
    if any(r.startswith('FAIL') for r in results):
        sys.exit(1)


if __name__ == '__main__':
    main()
