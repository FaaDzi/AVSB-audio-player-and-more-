import json
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from names import base, key

hp = json.loads((ROOT / "app/public/data/headphones.json").read_text(encoding="utf-8"))["iems"]
search_file = ROOT / "app/public/data/images_search.json"
search_data = json.loads(search_file.read_text(encoding="utf-8")) if search_file.exists() else {}

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

# 1. Base name lookup
base_img_lookup = {}
for h in hp:
    if h["id"] in mergedImages:
        b = key(base(h["name"]))
        if b not in base_img_lookup:
            base_img_lookup[b] = mergedImages[h["id"]]

# 2. ID prefix lookup
id_prefix_lookup = {}
for h in hp:
    if h["id"] in mergedImages:
        parts = h["id"].split("-")
        for plen in (4, 3, 2):
            if len(parts) >= plen:
                prefix = "-".join(parts[:plen])
                if prefix not in id_prefix_lookup:
                    id_prefix_lookup[prefix] = mergedImages[h["id"]]

added = 0
for h in hp:
    hid = h["id"]
    if hid in mergedImages or hid in search_data:
        continue
    # Try base match
    b = key(base(h["name"]))
    matched = base_img_lookup.get(b)
    if not matched:
        clean = re.sub(r'\(.*?\)', '', h["name"]).strip()
        cb = key(clean)
        matched = base_img_lookup.get(cb)
    if not matched:
        parts = hid.split("-")
        for plen in (4, 3):
            if len(parts) > plen:
                prefix = "-".join(parts[:plen])
                if prefix in id_prefix_lookup:
                    matched = id_prefix_lookup[prefix]
                    break
    if matched:
        search_data[hid] = {
            "src": matched.get("src") or matched.get("url"),
            "store": matched.get("store", "Variant match"),
            "url": matched.get("url", ""),
            "title": h["name"]
        }
        added += 1

search_file.write_text(json.dumps(search_data, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Propagated {added} headphone variants into images_search.json! (Total search entries: {len(search_data)})")

