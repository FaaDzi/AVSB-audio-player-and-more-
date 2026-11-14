import csv
import json
import re
from pathlib import Path

hp = json.load(open("app/public/data/headphones.json", encoding="utf-8"))["iems"]
print(f"Total headphones in catalog: {len(hp)}")

def norm(s):
    s = s.lower()
    s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s

catalog_norm = {}
for h in hp:
    n = norm(h["name"])
    if n not in catalog_norm:
        catalog_norm[n] = h["id"]

# 1. Resolve
resolve_rows = list(csv.DictReader(open("data/raw/resolve_headphones.csv", encoding="utf-8-sig")))
resolve_matched = 0
for r in resolve_rows:
    name = r.get("Headphone", "").strip()
    notes = r.get("Notes", "").strip()
    if not name or not notes:
        continue
    n = norm(name)
    matched_id = catalog_norm.get(n)
    if not matched_id:
        for cn, hid in catalog_norm.items():
            if n in cn or cn in n:
                matched_id = hid
                break
    if matched_id:
        resolve_matched += 1

print(f"Resolve headphone matches: {resolve_matched} / {len(resolve_rows)}")

# 2. Crinacle
crin_html = Path("data/raw/crin_headphones.html").read_text(encoding="utf-8")
table_m = re.search(r'<table[^>]*id="tablepress-6"[^>]*>(.*?)</table>', crin_html, re.S)
rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_m.group(1), re.S)
crin_matched = 0
crin_total = 0
for r in rows[1:]:
    tds = re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)
    if not tds:
        continue
    cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t)).strip() for t in tds]
    name = cells[2]
    comment = cells[5]
    if not comment:
        continue
    crin_total += 1
    n = norm(name)
    matched_id = catalog_norm.get(n)
    if not matched_id:
        for cn, hid in catalog_norm.items():
            if n in cn or cn in n:
                matched_id = hid
                break
    if matched_id:
        crin_matched += 1

print(f"Crinacle headphone matches: {crin_matched} / {crin_total}")

# 3. Listener
listener_rows = list(csv.DictReader(open("data/raw/listener_headphones.csv", encoding="utf-8-sig")))
listener_matched = 0
for r in listener_rows:
    name = r.get("Headphone", "").strip()
    notes = r.get("Notes", "").strip()
    if not name or not notes:
        continue
    n = norm(name)
    matched_id = catalog_norm.get(n)
    if not matched_id:
        for cn, hid in catalog_norm.items():
            if n in cn or cn in n:
                matched_id = hid
                break
    if matched_id:
        listener_matched += 1

print(f"Listener headphone matches: {listener_matched} / {len(listener_rows)}")

