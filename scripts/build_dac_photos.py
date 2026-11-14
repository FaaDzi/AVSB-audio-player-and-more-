"""Shop photos for the DACs and dongles in app/public/data/devices.json (plan §79 G).

Matches each DAC's name against the product titles in the saved shop feeds (data/raw/stores/*.json, from
build_images.py's store fetch): the name's words in a row in the title (the strict rule build_images.py uses), or
failing that, every word of the name somewhere in the title. Cables, cases and "for <model>" accessories are skipped.
Saves a small WebP (max 200 px) in app/public/img/dac/ and adds "photo" to each matched DAC in devices.json.
DACs with no match keep no photo (the app shows an icon).

Usage: python -I scripts/build_dac_photos.py
"""
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
import numpy as np  # noqa: E402
from build_images import match, thumb_url, tokens  # noqa: E402
from clean_backgrounds import plainness  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEVICES = ROOT / "app" / "public" / "data" / "devices.json"
IMG = ROOT / "app" / "public" / "img" / "dac"
EDITION = {"pro", "max", "plus", "ii", "2", "3", "lite", "mini", "ti", "se", "elite", "x"}
BUNDLE = re.compile(r"\b(iem|bundle|earphones?|in-ear)\b", re.I)
NOT_THE_DAC = re.compile(r"\b(cable|case|pouch|bag|adapter cable|extension|replacement|open box|b-stock|refurb)\b", re.I)


def load_products():
    out = []
    for f in sorted((ROOT / "data" / "raw" / "stores").glob("*.json")):
        try:
            items = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - a damaged feed just isn't used
            continue
        for p in items if isinstance(items, list) else []:
            imgs = p.get("images")
            if isinstance(imgs, str):
                imgs = re.findall(r"https?://[^'\"\s,\]]+", imgs)
            if imgs and p.get("title") and not NOT_THE_DAC.search(p["title"]):
                out.append({"title": p["title"], "url": p.get("url"), "images": imgs, "tok": tokens(p["title"]), "store": f.stem})
    return out


def best_photo(srcs):
    choice, best = None, -1.0
    for src in srcs[:3]:
        try:
            req = urllib.request.Request(thumb_url(src), headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                img = Image.open(io.BytesIO(r.read()))
            img.load()
            time.sleep(0.1)
        except Exception as e:  # noqa: BLE001
            print(f"  image failed: {e}")
            continue
        transparent = "A" in img.getbands() or "transparency" in img.info
        img = img.convert("RGBA" if transparent else "RGB")
        img.thumbnail((200, 200))
        plain = 1.0 if transparent else plainness(np.asarray(img.convert("RGB")))
        if plain >= 0.85:
            return img
        if plain > best:
            choice, best = img, plain
    return choice


def main():
    devices = json.loads(DEVICES.read_text(encoding="utf-8"))
    products = load_products()
    IMG.mkdir(parents=True, exist_ok=True)
    found = 0
    for d in devices["dacs"]:
        # "Shanling UA1 / UA1 Plus / UA1 Pro" and "Moondrop Dawn (3.5 / 4.4)": the first model named
        t = tokens(re.sub(r"\(.*?\)", "", d["name"]).split(" / ")[0])
        if len(t) < 2:
            continue
        # a title that names another edition ("Pro", "Max", "II"...) or bundles an IEM is another product
        ok = lambda p: not (set(p["tok"]) - set(t)) & EDITION and not BUNDLE.search(p["title"])  # noqa: E731
        hits = [p for p in products if match(t, p["tok"]) and ok(p)] or [p for p in products if set(t) <= set(p["tok"]) and ok(p)]
        if not hits:
            print(f"-      {d['name']}")
            continue
        best = min(hits, key=lambda p: len(p["tok"]))
        slug = re.sub(r"[^a-z0-9]+", "-", d["name"].lower()).strip("-")
        dest = IMG / f"{slug}.webp"
        if not dest.exists():
            img = best_photo(best["images"])
            if img is None:
                continue
            img.save(dest, "WEBP", quality=75, method=6)
        d["photo"] = f"img/dac/{slug}.webp"
        found += 1
        print(f"photo  {d['name']}  <- {best['store']}: {best['title']}")
    DEVICES.write_text(json.dumps(devices, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{found} of {len(devices['dacs'])} DACs have a photo")


if __name__ == "__main__":
    main()
