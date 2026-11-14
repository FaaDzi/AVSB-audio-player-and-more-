import json
import sys
from pathlib import Path

ROOT = Path(".")
sys.path.insert(0, str(ROOT / "scripts"))
from names import base, key

crin = json.load(open("data/reviewers/crinacle.json", encoding="utf-8"))["entries"]
iems = json.load(open("app/public/data/iems.json", encoding="utf-8"))["iems"]
by_key = {key(i["name"]): i for i in iems}
by_base = {key(base(i["name"])): i for i in iems}

matches = []
for e in crin:
    if e.get("nameConfidence") == "low":
        raw = e["name"]
        m = by_key.get(key(raw)) or by_base.get(key(base(raw)))
        if m:
            matches.append((raw, m["name"], m["id"], e.get("grade"), e.get("quote", "")))

print(f"Total low confidence entries that match catalog: {len(matches)}")
for raw, target, tid, g, q in matches:
    print(f"  [{g}] \"{raw}\" ===> \"{target}\" ({tid}) -> {q[:60]}...")

