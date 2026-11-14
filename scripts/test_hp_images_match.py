import json
import re
from pathlib import Path

hp = json.load(open("app/public/data/headphones.json", encoding="utf-8"))["iems"]
images = json.load(open("app/public/data/images.json", encoding="utf-8"))

missing_hp = [h for h in hp if h["id"] not in images]
print(f"Total headphones missing images in images.json: {len(missing_hp)}")

# Load store products
stores_dir = Path("data/raw/stores")
products = []
for pfile in stores_dir.glob("*.json"):
    try:
        data = json.loads(pfile.read_text(encoding="utf-8"))
        for item in data:
            if item.get("images"):
                products.append({
                    "store": pfile.stem,
                    "title": item["title"],
                    "url": item["url"],
                    "image": item["images"][0]
                })
    except Exception:
        pass

print(f"Total store products loaded: {len(products)}")

def norm(s):
    s = s.lower()
    s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s

# Index products by words
product_by_word = {}
for p in products:
    t = norm(p["title"]).split()
    for w in t:
        if len(w) > 3:
            product_by_word.setdefault(w, []).append(p)

matched = 0
found_matches = []
for h in missing_hp:
    hn = norm(h["name"])
    tokens = hn.split()
    if len(tokens) >= 2:
        # Check if first two tokens exist
        candidates = product_by_word.get(tokens[1], [])
        for cand in candidates:
            cn = norm(cand["title"])
            if all(tok in cn.split() for tok in tokens[:3]):
                matched += 1
                found_matches.append((h["name"], h["id"], cand["title"], cand["image"], cand["store"], cand["url"]))
                break

print(f"Matches found in store products: {len(found_matches)}")
for m in found_matches[:15]:
    print(f"  {m[0]} -> {m[2]} ({m[4]})")

