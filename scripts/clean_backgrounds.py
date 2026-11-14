"""Make plain (near-white / near-uniform) photo backgrounds transparent.

Flood-fills from the image border over pixels close to the border colour, so only the
background connected to the edges is removed (white parts inside the IEM stay). Images
whose border isn't a single plain colour are left untouched and listed, rather than guessed at.

Usage: python -I scripts/clean_backgrounds.py [folder]   (default: app/public/img/iem)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
TOL = 28          # max colour distance from the border colour that still counts as background
PLAIN = 0.85      # share of border pixels that must match the border colour for a "plain" background


def flood_mask(rgb: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Boolean mask of background pixels connected to the border (4-connected BFS, vectorised by rows)."""
    h, w, _ = rgb.shape
    close = np.linalg.norm(rgb.astype(np.int16) - bg.astype(np.int16), axis=2) <= TOL
    mask = np.zeros((h, w), bool)
    mask[0, :] = close[0, :]
    mask[-1, :] = close[-1, :]
    mask[:, 0] = close[:, 0]
    mask[:, -1] = close[:, -1]
    # iterate dilation within `close` until stable (fast enough for 200 px thumbnails)
    while True:
        grown = mask.copy()
        grown[1:, :] |= mask[:-1, :]
        grown[:-1, :] |= mask[1:, :]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        grown &= close
        if (grown == mask).all():
            return mask
        mask = grown


def plainness(rgb: np.ndarray) -> float:
    """Share of border pixels within TOL of the border's median colour (1.0 = perfectly plain)."""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.int16)
    bg = np.median(border, axis=0)
    return float((np.linalg.norm(border - bg, axis=1) <= TOL).mean())


def clean(path: Path) -> str:
    img = Image.open(path)
    if img.mode == "RGBA" and np.asarray(img)[..., 3].min() < 250:
        return "already transparent"
    rgb = np.asarray(img.convert("RGB"))
    if plainness(rgb) < PLAIN:
        return "busy background (left as is)"
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    mask = flood_mask(rgb, bg)
    if mask.mean() < 0.05:
        return "no background found"
    if mask.mean() > 0.97:
        return "would remove almost everything (left as is)"
    alpha = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    out = Image.fromarray(rgb).convert("RGBA")
    out.putalpha(alpha)
    out.save(path, "WEBP", quality=75, method=6)
    return "cleaned"


def main(folder: Path):
    stats = {}
    skipped = []
    for p in sorted(folder.glob("*.webp")):
        r = clean(p)
        stats[r] = stats.get(r, 0) + 1
        if "left as is" in r:
            skipped.append(p.name)
    print(stats)
    if skipped:
        (ROOT / "data" / "images_not_cleaned.txt").write_text("\n".join(skipped) + "\n", encoding="utf-8")
        print(f"{len(skipped)} listed in data/images_not_cleaned.txt")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "app" / "public" / "img" / "iem")
