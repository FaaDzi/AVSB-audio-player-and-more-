"""Fetch images for missing IEMs and Headphones using cached store feeds and web sources."""
import glob
import io
import json
import re
import sys
import time
import urllib.request
import unicodedata
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from names import base, key
from clean_backgrounds import clean, plainness
from build_images import ACCESSORY, allowed_next
from PIL import Image

CATALOG_IEMS = ROOT / "app" / "public" / "data" / "iems.json"
CATALOG_HP = ROOT / "app" / "public" / "data" / "headphones.json"
IMG_DIR = ROOT / "app" / "public" / "img" / "iem"
OUT = ROOT / "app" / "public" / "data" / "images_search.json"
ALIASES = ROOT / "app" / "public" / "data" / "aliases.json"
SIZE = 200
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

PAD_SWAP_PAT = re.compile(r'\b(pads?|earpads?|dekoni|zmf|sheepskin|velour|alcantara|fenestrated|leather|hybrid|mesh|cooling gel|suede)\b', re.I)

def norm_tokens(s: str) -> list[str]:
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')
    s = re.sub(r'\(.*?\)', ' ', s)
    s = re.sub(r'(?i)\b(filter|mesh|mod|foam|spring|tips?|nozzle|stock|sample|unit|impedance|cable)\b.*', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()
    return s.split()

def main():
    iems = json.load(open(CATALOG_IEMS, encoding="utf-8"))["iems"]
    hp = json.load(open(CATALOG_HP, encoding="utf-8"))["iems"]
    aliases = json.load(open(ALIASES, encoding="utf-8")).get("merge", {}) if ALIASES.exists() else {}
    
    # Load all existing images
    merged_existing = {}
    for f in glob.glob(str(ROOT / "app" / "public" / "data" / "images*.json")):
        if Path(f).name == "images_search.json":
            continue
        try:
            merged_existing.update(json.load(open(f, encoding="utf-8")))
        except Exception:
            pass

    search_images = {}
    if OUT.exists():
        try:
            search_images = json.load(open(OUT, encoding="utf-8"))
        except Exception:
            pass
            
    # Combine catalog items: visible items first
    all_gear = [i for i in (iems + hp) if i["id"] not in aliases]
    
    missing_by_base = defaultdict(list)
    for g in all_gear:
        gid = g["id"]
        if gid not in merged_existing and gid not in search_images:
            # Clean base name
            clean_name = re.sub(r'\(.*?\)', '', g["name"]).strip()
            missing_by_base[clean_name].append(gid)

    print(f"Total unique missing base models across IEMs and Headphones: {len(missing_by_base)}")

    # Load store feeds and build inverted index by token
    print("Loading cached store feeds...")
    store_products = []
    token_index = defaultdict(set)
    for sf in glob.glob(str(ROOT / "data" / "raw" / "stores" / "*.json")):
        store_name = Path(sf).stem
        try:
            items = json.load(open(sf, encoding="utf-8"))
            for p in items:
                imgs = p.get("images")
                if not imgs:
                    continue
                title = p.get("title", "")
                if ACCESSORY.search(title) or PAD_SWAP_PAT.search(title):
                    continue
                toks = norm_tokens(title)
                if not toks:
                    continue
                p_idx = len(store_products)
                store_products.append({
                    "title": title,
                    "toks": toks,
                    "images": imgs,
                    "url": p.get("url", ""),
                    "store": store_name,
                })
                for t in set(toks):
                    token_index[t].add(p_idx)
        except Exception:
            pass

    print(f"Loaded {len(store_products)} clean store products into index.")

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    matched_count = 0

    for model_name, ids in list(missing_by_base.items()):
        toks = norm_tokens(model_name)
        if len(toks) < 2:
            continue
        
        cand_indices = token_index.get(toks[0])
        if not cand_indices:
            continue

        matches = []
        for idx in cand_indices:
            p = store_products[idx]
            ptoks = p["toks"]
            n = len(toks)
            found = False
            for i in range(len(ptoks) - n + 1):
                if ptoks[i:i+n] == toks:
                    nxt = ptoks[i+n] if (i+n) < len(ptoks) else None
                    if allowed_next(nxt):
                        found = True
                        break
            if found:
                matches.append(p)

        if not matches:
            continue

        best = min(matches, key=lambda p: len(p["toks"]))
        slug = re.sub(r"[^a-z0-9]+", "-", model_name.lower()).strip("-")
        dest = IMG_DIR / f"{slug}.webp"

        if not dest.exists():
            img_choice = None
            for src in best["images"][:3]:
                try:
                    url = src if src.startswith("http") else ("https:" + src if src.startswith("//") else src)
                    url = url + ("&" if "?" in url else "?") + f"width={SIZE * 2}"
                    req = urllib.request.Request(url, headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=15) as r:
                        raw_data = r.read()
                    img = Image.open(io.BytesIO(raw_data))
                    img.load()
                    transparent = "A" in img.getbands() or "transparency" in img.info
                    img = img.convert("RGBA" if transparent else "RGB")
                    img.thumbnail((SIZE, SIZE))
                    img_choice = img
                    break
                except Exception:
                    continue

            if not img_choice:
                continue

            img_choice.save(dest, "WEBP", quality=75, method=6)
            clean(dest)

        # Register in search_images
        for item_id in ids:
            search_images[item_id] = {
                "src": f"img/iem/{slug}.webp",
                "store": best["store"],
                "url": best["url"],
                "title": best["title"],
            }
        matched_count += 1
        print(f"Matched {model_name} -> {best['title']} ({best['store']}) [{len(ids)} ids]")

    OUT.write_text(json.dumps(search_images, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nDone! Matched {matched_count} base models. Total search images: {len(search_images)}")

if __name__ == "__main__":
    main()
