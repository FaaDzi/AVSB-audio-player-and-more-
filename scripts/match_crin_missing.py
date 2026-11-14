import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, "scripts")
from names import base, key

iems = json.load(open("app/public/data/iems.json", encoding="utf-8"))["iems"]
all_images = {}
for p in Path("app/public/data").glob("images*.json"):
    all_images.update(json.load(open(p, encoding="utf-8")))

missing_iems = {i["id"]: i for i in iems if i["id"] not in all_images}
print(f"Missing IEMs count: {len(missing_iems)}")

# Parse Crinacle table
html = open("data/raw/reviewers/crinacle/rankings.html", encoding="utf-8").read()
rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)

crin_entries = []
for r in rows:
    tds = re.findall(r'<td[^>]*>(.*?)</td>', r, re.DOTALL)
    if len(tds) >= 8:
        grade = re.sub(r'<[^>]+>', '', tds[1]).strip()
        model = re.sub(r'<[^>]+>', '', tds[4]).strip()
        note = re.sub(r'<[^>]+>', '', tds[5]).strip()
        price = re.sub(r'<[^>]+>', '', tds[6]).strip()
        sig = re.sub(r'<[^>]+>', '', tds[7]).strip()
        comments = re.sub(r'<[^>]+>', '', tds[8]).strip() if len(tds) > 8 else ""
        tone = re.sub(r'<[^>]+>', '', tds[9]).strip() if len(tds) > 9 else ""
        tech = re.sub(r'<[^>]+>', '', tds[10]).strip() if len(tds) > 10 else ""
        full_name = f"{model} {note}".strip()
        crin_entries.append({
            "model": model, "note": note, "full_name": full_name,
            "grade": grade, "price": price, "sig": sig, "comments": comments,
            "tone": tone, "tech": tech
        })

print(f"Parsed {len(crin_entries)} Crinacle entries.")

# Match against missing models
matches = []
for cid, item in missing_iems.items():
    ik = key(base(item["name"]))
    for c in crin_entries:
        ck = key(c["full_name"])
        cmk = key(c["model"])
        if ik == ck or ik == cmk:
            matches.append((cid, item["name"], c))
            break

print(f"Found {len(matches)} matches in Crinacle rankings for missing items:")
for cid, name, c in matches[:15]:
    print(f"  [{c['grade']}] {cid} ({name}) -> {c['comments']}")

