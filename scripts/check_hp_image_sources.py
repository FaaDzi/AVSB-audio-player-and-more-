import json
from collections import Counter

images = json.load(open("app/public/data/images.json", encoding="utf-8"))
hp_stores = Counter()
for k, v in images.items():
    if k.startswith("hp-"):
        hp_stores[v.get("store", "unknown")] += 1

print("Headphone image sources:")
for s, c in hp_stores.most_common(20):
    print(f"  {s}: {c}")

