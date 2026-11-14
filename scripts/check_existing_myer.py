import glob
import json

all_images = {}
for p in glob.glob("app/public/data/images*.json"):
    all_images.update(json.load(open(p, encoding="utf-8")))

for k, v in all_images.items():
    if any(x in k.lower() for x in ["myer", "cklvx", "sliivo"]):
        src = v.get("src") or v.get("url")
        store = v.get("store")
        print(f"{k} -> {src} ({store})")

