import json
import re
from pathlib import Path
import sys

ROOT = Path(".")
sys.path.insert(0, str(ROOT / "scripts"))
from names import base, key

hp = json.load(open("app/public/data/headphones.json", encoding="utf-8"))["iems"]

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
        data = json.load(open(f"app/public/data/{j}", encoding="utf-8"))
        mergedImages.update(data)
    except Exception:
        pass

# Map base keys of headphones that HAVE images
base_img_lookup = {}
for h in hp:
    if h["id"] in mergedImages:
        b = key(base(h["name"]))
        if b not in base_img_lookup:
            base_img_lookup[b] = mergedImages[h["id"]]

# Also prefix lookup on ID (e.g. hp-sennheiser-hd-600)
id_prefix_lookup = {}
for h in hp:
    if h["id"] in mergedImages:
        parts = h["id"].split("-")
        for plen in (4, 3, 2):
            if len(parts) >= plen:
                prefix = "-".join(parts[:plen])
                if prefix not in id_prefix_lookup:
                    id_prefix_lookup[prefix] = mergedImages[h["id"]]

propagate_candidates = []
unmatched_missing = []

for h in hp:
    if h["id"] in mergedImages:
        continue
    # 1. Base name match
    b = key(base(h["name"]))
    matched = base_img_lookup.get(b)
    if not matched:
        # 2. Try stripping parens
        clean = re.sub(r'\(.*?\)', '', h["name"]).strip()
        cb = key(clean)
        matched = base_img_lookup.get(cb)
    if not matched:
        # 3. ID prefix match
        parts = h["id"].split("-")
        for plen in (4, 3):
            if len(parts) > plen:
                prefix = "-".join(parts[:plen])
                if prefix in id_prefix_lookup:
                    matched = id_prefix_lookup[prefix]
                    break
    if matched:
        propagate_candidates.append((h["id"], h["name"], matched))
    else:
        unmatched_missing.append((h["id"], h["name"]))

print(f"Total headphones: {len(hp)}")
print(f"Missing image: {len(propagate_candidates) + len(unmatched_missing)}")
print(f"Can be resolved by base/variant propagation: {len(propagate_candidates)}")
print(f"Truly missing base models: {len(unmatched_missing)}")

print("\nSample resolvable variants:")
for cid, cname, m in propagate_candidates[:15]:
    print(f"  {cname} -> {m.get('src')}")

print("\nSample truly missing base models:")
for uid, uname in unmatched_missing[:20]:
    print(f"  {uname} ({uid})")

