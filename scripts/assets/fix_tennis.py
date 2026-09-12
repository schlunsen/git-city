#!/usr/bin/env python3
"""Fix lots-6.png (tennis): the model painted the fence surround pink instead
of pure magenta, and the fence frame/posts sit in the side bands. Crop the
tile to the court itself: everything outside the green court's horizontal
extent becomes transparent.
"""
import numpy as np
from PIL import Image
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent.parent / 'public' / 'assets'

im = Image.open(ASSETS / 'lots-6.png').convert('RGBA')
px = np.array(im)
r, g, b = px[..., 0].astype(int), px[..., 1].astype(int), px[..., 2].astype(int)
green = (g > 100) & (g > r + 20) & (g > b + 20) & (px[..., 3] > 0)
cols = np.flatnonzero(green.any(axis=0))
x0, x1 = cols.min(), cols.max()
print(f'court spans x {x0}..{x1} of {px.shape[1]}')
px[..., 3][:, :x0] = 0
px[..., 3][:, x1 + 1:] = 0
Image.fromarray(px).save(ASSETS / 'lots-6.png')
print('saved lots-6.png')
