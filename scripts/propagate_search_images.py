import json
from pathlib import Path
import sys

ROOT = Path(".")
sys.path.insert(0, str(ROOT / "scripts"))
from names import base, key

iems = json.load(open(ROOT / "app/public/data/iems.json", encoding="utf-8"))["iems"]
search_file = ROOT / "app/public/data/images_search.json"
search_data = json.load(open(search_file, encoding="utf-8"))

# All available images
all_images = {}
for p in (ROOT / "app/public/data").glob("images*.json"):
    all_images.update(json.load(open(p, encoding="utf-8")))

# Index existing base images
base_lookup = {}
for i in iems:
    iid = i["id"]
    if iid in all_images:
        src = all_images[iid].get("src") or all_images[iid].get("url")
        if src and (ROOT / "app/public" / src.lstrip("/")).exists():
            b_key = key(base(i["name"]))
            if b_key not in base_lookup:
                base_lookup[b_key] = all_images[iid]

# Also index by iid base prefix (e.g. 'simgot-ew300', 'elysian-annihilator', 'campfire-audio-andromeda')
id_prefix_lookup = {}
for iid, info in list(all_images.items()):
    src = info.get("src") or info.get("url")
    if src and (ROOT / "app/public" / src.lstrip("/")).exists():
        # parts up to 2 or 3 tokens
        parts = iid.split("-")
        for plen in (2, 3, 4):
            if len(parts) >= plen:
                prefix = "-".join(parts[:plen])
                if prefix not in id_prefix_lookup:
                    id_prefix_lookup[prefix] = info

propagated = 0
for i in iems:
    iid = i["id"]
    if iid in all_images:
        continue
    
    # 1. Try base name match
    b_key = key(base(i["name"]))
    matched = base_lookup.get(b_key)
    
    # 2. Try ID prefix match if base match failed
    if not matched:
        parts = iid.split("-")
        for plen in (4, 3, 2):
            if len(parts) > plen:
                prefix = "-".join(parts[:plen])
                if prefix in id_prefix_lookup:
                    matched = id_prefix_lookup[prefix]
                    break
    
    if matched:
        search_data[iid] = {
            "src": matched.get("src") or matched.get("url"),
            "store": matched.get("store", "propagated"),
            "url": matched.get("url", ""),
            "title": f"{i['name']} (derived)"
        }
        all_images[iid] = search_data[iid]
        propagated += 1

search_file.write_text(json.dumps(search_data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Propagated {propagated} variant images into images_search.json.")
print(f"Total search images now: {len(search_data)}")

