#!/usr/bin/env python3
"""Derive public/assets/grass-detail.png from public/assets/grass.png.

The island's ground is coloured per vertex (meadow bands, forest, highland,
sand, rock), so its texture must carry only the tufts and flowers. grass.png
has two flat grass bands baked in: this finds those two colours and divides
them out, leaving plain grass white. Rerun it whenever grass.png changes.

usage: python3 scripts/assets/grass_detail.py [--src public/assets/grass.png] [--out public/assets/grass-detail.png]
Requires Pillow and numpy.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ASSETS = Path(__file__).resolve().parents[2] / 'public' / 'assets'


def grass_detail(im):
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    # The two flat band colours are the most common colours: the top 12
    # (quantised), split by luminance into a light and a dark group.
    q = (a // 4).astype(np.int32)
    key = q[..., 0] * 4096 + q[..., 1] * 64 + q[..., 2]
    vals, counts = np.unique(key, return_counts=True)
    top = vals[np.argsort(-counts)[:12]]
    cols = np.stack([(top // 4096) * 4 + 2, (top // 64 % 64) * 4 + 2, (top % 64) * 4 + 2], 1).astype(np.float32)
    lum = cols @ np.array([.3, .59, .11])
    light, dark = cols[lum >= np.median(lum)].mean(0), cols[lum < np.median(lum)].mean(0)
    # Which band each pixel sits in, decided on a median-filtered copy (ink removed).
    med = np.asarray(im.convert('RGB').filter(ImageFilter.MedianFilter(11))).astype(np.float32)
    in_light = np.linalg.norm(med - light, axis=-1) < np.linalg.norm(med - dark, axis=-1)
    band = np.where(in_light[..., None], light, dark)
    out = a / band
    out[np.linalg.norm(a - band, axis=-1) < 22] = 1.0  # plain band colour -> pure white
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)), light, dark


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', type=Path, default=ASSETS / 'grass.png')
    ap.add_argument('--out', type=Path, default=ASSETS / 'grass-detail.png')
    a = ap.parse_args()
    im, light, dark = grass_detail(Image.open(a.src))
    im.save(a.out)
    print(f'bands light {light.round()} dark {dark.round()} -> {a.out}')


if __name__ == '__main__':
    main()
