"""Cuts the Headroom logo out of its source image and writes icons/icon{16,32,48,128}.png.

    python scripts/make-icons.py [path-to-source-image]

The source is a square-ish image of the rounded tile on a white ground. The white outside the tile is
flood-filled to transparent from the borders, so the cat's own white fill (inside the tile) is untouched.
The 1024 px master is kept at assets/headroom-logo.png.
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "assets" / "headroom-logo-source.png"
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(int)

# bounding box of everything that is not near-white
ys, xs = np.where(a.sum(axis=2) < 700)
box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
im = im.crop(box).resize((1024, 1024), Image.LANCZOS)
a = np.asarray(im).astype(int)

# flood-fill the white ground from the four borders
h, w = a.shape[:2]
white = a.min(axis=2) >= 236
outside = np.zeros((h, w), bool)
q = deque((y, x) for y in (0, h - 1) for x in range(w) if white[y, x])
q.extend((y, x) for x in (0, w - 1) for y in range(h) if white[y, x])
for y, x in q:
    outside[y, x] = True
while q:
    y, x = q.popleft()
    for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        if 0 <= ny < h and 0 <= nx < w and white[ny, nx] and not outside[ny, nx]:
            outside[ny, nx] = True
            q.append((ny, nx))

alpha = Image.fromarray(np.where(outside, 0, 255).astype("uint8"), "L")
alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))  # trim the white fringe, soften
master = im.convert("RGBA")
master.putalpha(alpha)

(root / "assets").mkdir(exist_ok=True)
master.save(root / "assets" / "headroom-logo.png")
for size in (16, 32, 48, 128):
    master.resize((size, size), Image.LANCZOS).save(root / "icons" / f"icon{size}.png")
    print("icon", size)
