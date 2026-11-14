import re
from pathlib import Path

html = Path("data/raw/crin_headphones.html").read_text(encoding="utf-8")
table_m = re.search(r'<table[^>]*id="tablepress-6"[^>]*>(.*?)</table>', html, re.S)
if not table_m:
    print("tablepress-6 not found")
    exit(1)

table = table_m.group(1)
headers = [re.sub(r'<[^>]+>', '', h).strip() for h in re.findall(r'<th[^>]*>(.*?)</th>', table, re.S)]
print("Headers:", headers)

rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.S)
print("Total rows:", len(rows))

parsed = []
for r in rows[1:]:
    tds = re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)
    if not tds:
        continue
    cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t)).strip() for t in tds]
    img_m = re.search(r'src="([^"]+)"', r)
    img_url = img_m.group(1) if img_m else None
    parsed.append({"cells": cells, "img": img_url})

print(f"Parsed {len(parsed)} headphone entries.")
has_comments = [p for p in parsed if len(p['cells']) > 5 and p['cells'][5].strip()]
print(f"Headphones with non-empty comments: {len(has_comments)}")
has_img = [p for p in parsed if p.get('img')]
print(f"Headphones with images: {len(has_img)}")

for p in has_comments[:10]:
    c = p['cells']
    print(f"  [{c[0]}] {c[2]} (${c[3]}) - Tone: {c[6]}, Tech: {c[7]} -> {c[5][:80]} (img: {p['img'] is not None})")

