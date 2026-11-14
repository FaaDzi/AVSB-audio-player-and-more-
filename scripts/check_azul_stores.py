import glob
import json
from pathlib import Path

for p in glob.glob("data/raw/stores/*.json"):
    try:
        items = json.load(open(p, encoding="utf-8"))
        for it in items:
            t = it.get("title", "")
            if "azul" in t.lower() or "prisma" in t.lower():
                print(f"[{Path(p).name}] {t} -> {it.get('images', [])[:1]} ({it.get('url')})")
    except Exception:
        pass

