import csv
import json
import re

iems = json.load(open("app/public/data/iems.json", encoding="utf-8"))["iems"]
print(f"Total IEMs in catalog: {len(iems)}")

def norm(s):
    s = s.lower()
    s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s

catalog_norm = {}
for i in iems:
    n = norm(i["name"])
    if n not in catalog_norm:
        catalog_norm[n] = i["id"]

# Resolve IEMs
resolve_rows = list(csv.DictReader(open("data/raw/resolve_iems.csv", encoding="utf-8-sig")))
resolve_matched = 0
for r in resolve_rows:
    name = r.get("IEM", "") or r.get("Headphone", "")
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

print(f"Resolve IEM matches: {resolve_matched} / {len(resolve_rows)}")

# Listener IEMs
listener_rows = list(csv.DictReader(open("data/raw/listener_iems.csv", encoding="utf-8-sig")))
listener_matched = 0
for r in listener_rows:
    name = r.get("IEM", "") or r.get("Headphone", "")
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

print(f"Listener IEM matches: {listener_matched} / {len(listener_rows)}")

