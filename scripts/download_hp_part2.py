import json
import re
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from add_iem_image import add_image

hp = json.loads((ROOT / "app/public/data/headphones.json").read_text(encoding="utf-8"))["iems"]

jsonFiles = [
    'images.json',
    'images_search.json',
    'images_archive.json',
    'images_brand_a.json',
    'images_brand_b.json',
    'images_brand_c.json'
]

mergedImages = {}
for j in jsonFiles:
    try:
        data = json.loads((ROOT / f"app/public/data/{j}").read_text(encoding="utf-8"))
        mergedImages.update(data)
    except Exception:
        pass

missing_hp = [h for h in hp if h["id"] not in mergedImages]
print(f"Total missing headphones: {len(missing_hp)}")

# Load store products
stores_dir = ROOT / "data/raw/stores"
products = []
for pfile in stores_dir.glob("*.json"):
    try:
        data = json.loads(pfile.read_text(encoding="utf-8"))
        for item in data:
            if item.get("images") and not re.search(r"open box|b-stock|refurb|cable|case|stand|pad|adapter|cables", item["title"], re.I):
                products.append({
                    "store": pfile.stem,
                    "title": item["title"],
                    "url": item["url"],
                    "image": item["images"][0]
                })
    except Exception:
        pass

def norm(s):
    s = s.lower()
    s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s

def clean_toks(s):
    return [w for w in norm(s).split() if len(w) > 1 and w not in ('the', 'and', 'with', 'for', 'edition', 'headphones', 'headphone')]

prod_map = {}
for p in products:
    toks = clean_toks(p["title"])
    if len(toks) >= 2:
        k = " ".join(toks[:2])
        prod_map.setdefault(k, []).append((toks, p))

candidates = []
seen_slugs = set()

for h in missing_hp:
    htoks = clean_toks(h["name"])
    if len(htoks) < 2:
        continue
    k = " ".join(htoks[:2])
    matches = prod_map.get(k, [])
    best = None
    for ptoks, p in matches:
        if all(t in ptoks for t in htoks[:3]):
            best = p
            break
    if best:
        slug = "hp-" + re.sub(r'[^a-z0-9]+', '-', h["name"].lower()).strip('-')
        if slug not in seen_slugs:
            seen_slugs.add(slug)
            candidates.append((h["id"], h["name"], best["image"], best["store"], best["url"], best["title"]))

print(f"Clean candidates remaining: {len(candidates)}")

success = 0
for hid, hname, img_url, store, source_url, title in candidates[100:]:
    try:
        print(f"Downloading [{store}] {hname}...")
        ok = add_image(hid, img_url, store, source_url, title)
        if ok:
            success += 1
        time.sleep(0.1)
    except Exception as e:
        print(f"Error on {hname}: {e}")

print(f"\nSuccessfully downloaded and added {success} more headphone images!")

