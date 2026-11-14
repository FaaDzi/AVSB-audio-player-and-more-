import json
import re

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

POPULAR = [
    'sennheiser', 'sony', 'bose', 'apple', 'hifiman', 'beyerdynamic', 'audio technica', 'audio-technica',
    'akg', 'focal', 'audeze', 'meze', 'dan clark', 'shure', 'koss', 'grado', 'stax', 'philips', 'jbl',
    'bang & olufsen', 'bowers & wilkins', 'master & dynamic', 'denon', 'fostex', 'yamaha', 'monoprice',
    'drop', 'massdrop', 'austrian audio', 'v-moda', 'rode', 'fiio'
]

missing_popular = []
for h in hp:
    if h["id"] in mergedImages:
        continue
    low = h["name"].lower()
    if low.startswith("*mod") or low.startswith("[unbranded]") or "diy" in low:
        continue
    # check if popular
    brand = next((b for b in POPULAR if b in low), None)
    if brand:
        missing_popular.append((h["id"], h["name"], brand))

print(f"Total popular missing headphones: {len(missing_popular)}")

# Count by brand
from collections import Counter
counts = Counter(b for _, _, b in missing_popular)
print("Top missing by brand:")
for b, c in counts.most_common(20):
    print(f"  {b}: {c}")

print("\nSample popular missing headphones:")
for mid, mname, mb in missing_popular[:25]:
    print(f"  [{mb.upper()}] {mname} ({mid})")

