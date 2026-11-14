import glob
import json
from pathlib import Path

for p in glob.glob("data/raw/stores/*.json"):
    try:
        items = json.load(open(p, encoding="utf-8"))
        for it in items:
            t = it.get("title", "")
            if "rs one" in t.lower() or "rs-one" in t.lower() or "rs1" in t.lower() or "acoustune" in t.lower():
                print(f"[{Path(p).name}] {t} -> {it.get('images', [])[:1]} ({it.get('url')})")
    except Exception:
        pass

