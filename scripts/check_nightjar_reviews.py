import glob
import json

for p in glob.glob("data/reviewers/*.json"):
    data = json.load(open(p, encoding="utf-8"))
    entries = data.get("entries", [])
    for e in entries:
        n = e.get("name", "").lower()
        if "singularity" in n or "duality" in n or "nightjar" in n:
            print(f"[{data.get('reviewer')}] {e.get('name')} -> {e.get('quote')}")

