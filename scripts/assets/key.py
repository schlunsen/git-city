#!/usr/bin/env python3
"""Turn a generated magenta-background sheet into Gitilla PNGs in public/assets/.

usage:
  python3 scripts/assets/key.py row   scripts/assets/raw/rockets.png --name landmarks --start 4 --pick 0
  python3 scripts/assets/key.py row   scripts/assets/raw/trees.png   --name trees            # trees-0.png, trees-1.png, ...
  python3 scripts/assets/key.py row   scripts/assets/raw/scenery_accents.png --names props-fountain props-dock scenery-autumn-tree scenery-rock-cluster
  python3 scripts/assets/key.py grid  scripts/assets/raw/roofs.png   --name roofs            # 2x2 top-down tiles
  python3 scripts/assets/key.py tile  scripts/assets/raw/grass.png   --name grass            # seamless square
  python3 scripts/assets/key.py strip scripts/assets/raw/hills.png   --name hills            # panorama keyed above the ridge

Modes:
  row    a sprite sheet with N objects side by side: keyed, split on the empty
         columns, trimmed, scaled to --max-side. --pick keeps only some sprites
         (indices left to right), --start numbers them (landmarks-4, ...).
  grid   a 2x2 sheet of opaque top-down tiles (lots, roofs): split, squared, 512px.
  tile   a seamless square texture (grass, water): squared, 512px, no keying.
  strip  a wide backdrop (hills): keyed, trimmed, 2048px wide.

Every run also writes <raw>.preview.png: the results on a neutral blue-grey
backdrop, so pink fringes or clipped edges are easy to spot. Look at it.
Requires Pillow and numpy.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parents[2] / 'public' / 'assets'


def key(im, thresh=70, soft=40, frame=3, tight=45):
    """Magenta -> alpha. Models never paint exactly #FF00FF, so the background
    colour is the median of the image border.
    - Pixels closer than `tight` to it are background anywhere (holes too).
    - Softer matches only fade within 2 px of that background: the anti-aliased
      rim. Colours inside the ink outlines that merely resemble the background
      (a red apple, a brown trunk) stay opaque and keep their colour; the
      background often comes back a dusty rose, uncomfortably close to them.
    - Rim pixels are un-mixed from the background (despill), so no pink fringe survives.
    - `frame` px along the image edge are forced transparent: models sometimes
      paint a hairline there, and one opaque pixel per column is enough to glue
      a whole row of sprites together."""
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((d - thresh) / soft, 0, 1)
    sure_bg = d < tight
    rim = np.asarray(Image.fromarray((sure_bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    alpha = np.where(sure_bg, 0.0, np.where(rim, alpha, 1.0))
    if frame:
        alpha[:frame], alpha[-frame:], alpha[:, :frame], alpha[:, -frame:] = 0, 0, 0, 0
    al = alpha[..., None]
    rgb = np.where(al > 0.02, (a - (1 - al) * bg) / np.maximum(al, 0.02), a)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)), bg


def segments(mask1d, min_gap=6, min_len=12):
    """Runs of True separated by at least min_gap False entries."""
    segs, start, run = [], None, 0
    for i, v in enumerate(mask1d):
        if v:
            if start is None:
                start = i
            run = 0
        elif start is not None:
            run += 1
            if run >= min_gap:
                if i - run - start >= min_len:
                    segs.append((start, i - run))
                start, run = None, 0
    if start is not None and len(mask1d) - start >= min_len:
        segs.append((start, len(mask1d)))
    return segs


def crop_alpha(im, pad=4):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return im
    return im.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(im.width, xs.max() + pad), min(im.height, ys.max() + pad)))


def fit(im, max_side):
    s = max_side / max(im.size)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS) if s < 1 else im


def row(raw, a):
    im, bg = key(Image.open(raw))
    alpha = np.asarray(im)[..., 3]
    sprites = [crop_alpha(im.crop((x0, 0, x1, im.height))) for x0, x1 in segments((alpha > 8).sum(0) > 2)]
    specks = [s for s in sprites if min(s.size) < a.min_px]
    sprites = [s for s in sprites if min(s.size) >= a.min_px]  # stray specks the model sometimes leaves
    print(f'background {bg.astype(int)}: {len(sprites)} sprites' + (f' ({len(specks)} specks dropped)' if specks else ''))
    picks = a.pick if a.pick is not None else range(len(sprites))
    names = a.names or [f'{a.name}-{a.start + n}' for n in range(len(picks))]
    if len(names) != len(picks):
        raise SystemExit(f'--names gives {len(names)} names for {len(picks)} sprites')
    return [(names[n], fit(sprites[i], a.max_side)) for n, i in enumerate(picks)]


def grid(raw, a, size=512):
    im, bg = key(Image.open(raw))
    alpha = np.asarray(im)[..., 3]
    cols = segments((alpha > 8).sum(0) > 2, min_gap=3, min_len=40)
    rows = segments((alpha > 8).sum(1) > 2, min_gap=3, min_len=40)
    print(f'background {bg.astype(int)}: {len(cols)} x {len(rows)} tiles')
    out = []
    for y0, y1 in rows:
        for x0, x1 in cols:
            t = crop_alpha(im.crop((x0, y0, x1, y1)), pad=0)
            side = min(t.size)  # top-down tiles are opaque squares
            out.append((f'{a.name}-{a.start + len(out)}', t.crop((0, 0, side, side)).convert('RGB').resize((size, size), Image.LANCZOS)))
    return out


def tile(raw, a, size=512):
    im = Image.open(raw).convert('RGB')
    side = min(im.size)
    return [(a.name, im.crop((0, 0, side, side)).resize((size, size), Image.LANCZOS))]


def strip(raw, a, width=2048):
    im, _ = key(Image.open(raw), frame=0)  # the hills really do touch the edges
    im = crop_alpha(im, pad=0)
    return [(a.name, im.resize((width, round(im.height * width / im.width)), Image.LANCZOS))]


def preview(images, path):
    ims = [im.convert('RGBA') for _, im in images]
    scale = min(1, 360 / max(im.height for im in ims))
    ims = [im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale)))) for im in ims]
    sheet = Image.new('RGBA', (sum(im.width for im in ims) + 12 * (len(ims) + 1), max(im.height for im in ims) + 24), (90, 122, 154, 255))
    x = 12
    for im in ims:
        sheet.alpha_composite(im, (x, 12))
        x += im.width + 12
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('mode', choices=['row', 'grid', 'tile', 'strip'])
    ap.add_argument('raw', type=Path, help='the generated sheet (scripts/assets/raw/<name>.png)')
    ap.add_argument('--name', help='output name: <name>-<i>.png for row/grid, <name>.png otherwise')
    ap.add_argument('--names', nargs='+', help='row mode: one file name per sprite written (instead of <name>-<i>)')
    ap.add_argument('--start', type=int, default=0, help='first index to write (append to an existing set)')
    ap.add_argument('--pick', type=int, nargs='+', help='row mode: keep only these sprites (0-based, left to right)')
    ap.add_argument('--max-side', type=int, default=384, help='row mode: longest side in px (clouds use 512)')
    ap.add_argument('--min-px', type=int, default=40, help='row mode: drop sprites smaller than this (specks)')
    ap.add_argument('--out', type=Path, default=OUT, help='output folder (default public/assets)')
    a = ap.parse_args()
    if not a.name and not (a.mode == 'row' and a.names):
        ap.error('--name is required (or --names in row mode)')

    images = {'row': row, 'grid': grid, 'tile': tile, 'strip': strip}[a.mode](a.raw, a)
    a.out.mkdir(parents=True, exist_ok=True)
    for name, im in images:
        path = a.out / f'{name}.png'
        im.save(path, optimize=True)
        print(f'  {path.relative_to(a.out.parent.parent) if a.out == OUT else path}  {im.width}x{im.height}  {path.stat().st_size // 1024} KB')
    pv = a.raw.with_suffix('.preview.png')
    preview(images, pv)
    print(f'  preview: {pv}')


if __name__ == '__main__':
    main()
