import re, html, json, sys
from pathlib import Path

ROOT = Path(".")
sys.path.insert(0, str(ROOT / "scripts"))
sys.stdout.reconfigure(encoding="utf-8")

html_file = ROOT / "data" / "raw" / "reviewers" / "crinacle" / "rankings.html"
html_file.parent.mkdir(parents=True, exist_ok=True)

# Cache HTML
if not html_file.exists():
    import urllib.request
    req = urllib.request.Request("https://crinacle.com/rankings/iems/", headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=15).read()
    html_file.write_bytes(data)

page = html_file.read_text(encoding="utf-8", errors="ignore")

# Find table
tables = re.findall(r'<table[^>]*id="tablepress-10"[^>]*>(.*?)</table>', page, re.S)
if not tables:
    print("Could not find tablepress-10")
    sys.exit(1)

table = tables[0]
headers = re.findall(r'<th[^>]*>(.*?)</th>', table, re.S)
headers = [re.sub(r'<[^>]+>', '', h).strip() for h in headers]
print("Headers:", headers)

rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.S)
print("Total rows:", len(rows))

parsed = []
for r in rows[1:]: # skip header
    tds = re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)
    if not tds:
        continue
    cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t)).strip() for t in tds]
    # Check for image or link
    img_m = re.search(r'src="([^"]+)"', r)
    img_url = img_m.group(1) if img_m else None
    
    # Store raw td data
    parsed.append({
        "cells": cells,
        "img": img_url,
        "raw_tds": tds
    })

print(f"Parsed {len(parsed)} data rows.")
has_comments = [p for p in parsed if len(p['cells']) > 5 and p['cells'][5].strip()]
print(f"Rows with non-empty comments: {len(has_comments)}")
for p in has_comments[:15]:
    c = p['cells']
    print(f"  [{c[0]}] {c[2]} (${c[3]}) - Tone: {c[6]}, Tech: {c[7]}, Sig: {c[4]} -> {c[5][:90]}")

