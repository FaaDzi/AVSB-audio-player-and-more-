"""Search IEM names in Jay's phone book, iems.json and the sheet. Usage: name_lookup.py term [term...]"""
import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
R = Path(__file__).resolve().parent.parent
pb = json.load(open(R / "data/raw/jay/phone_book.json", encoding="utf-8"))
names = []
for b in pb:
    for p in b.get("phones", []):
        n = p.get("name") if isinstance(p, dict) else p
        if isinstance(n, list): n = n[0]
        names.append(("pb", f"{b.get('name')} {n}"))
for i in json.load(open(R / "app/public/data/iems.json", encoding="utf-8"))["iems"]:
    names.append(("iems", i["name"]))
for s in json.load(open(R / "data/jay_rankings.json", encoding="utf-8")):
    names.append(("SHEET", f"{s['name']} [{s['rank']}]"))
for t in sys.argv[1:]:
    hits = sorted({f"{src}:{n}" for src, n in names if re.search(t, n, re.I)})
    print(f"## {t}: " + " | ".join(hits[:25]) + (" ..." if len(hits) > 25 else ""))
