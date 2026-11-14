import json
import re
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding='utf-8')
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

missing_hp = [h for h in hp if h["id"] not in mergedImages]

base_groups = {}
for h in missing_hp:
    low = h["name"].lower()
    if low.startswith("*mod") or low.startswith("[unbranded]") or "diy" in low:
        continue
    # clean name
    clean = re.sub(r'\(.*?\)', '', h["name"]).strip()
    b = base(clean)
    base_groups.setdefault(b, []).append(h)

print(f"Total distinct base model families missing images: {len(base_groups)}")

# Sort by number of variants in catalog
sorted_bases = sorted(base_groups.items(), key=lambda x: len(x[1]), reverse=True)
print("\nTop 30 base model families with the most variants waiting for an image:")
for b, members in sorted_bases[:30]:
    print(f"  {b} ({len(members)} entries in catalog) -> e.g. {members[0]['name']}")

