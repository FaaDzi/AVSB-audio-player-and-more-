import re
from pathlib import Path

html = Path("data/raw/resolve_rankings.html").read_text(encoding="utf-8")

# Let's search for table or ranking rows or json embedded in the page
tables = re.findall(r'<table[^>]*>(.*?)</table>', html, re.S)
print("Found tables:", len(tables))

if tables:
    for i, t in enumerate(tables):
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S)
        print(f"Table {i}: {len(rows)} rows")
        if len(rows) > 1:
            headers = [re.sub(r'<[^>]+>', '', h).strip() for h in re.findall(r'<th[^>]*>(.*?)</th>', rows[0], re.S)]
            print("  Headers:", headers)
            sample_tds = [re.sub(r'<[^>]+>', '', d).strip() for d in re.findall(r'<td[^>]*>(.*?)</td>', rows[1], re.S)]
            print("  Row 1:", sample_tds)

# If no tables, check if it uses custom divs or JSON embedded in script tags
scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.S)
for s in scripts:
    if "ranking" in s.lower() or "sennheiser" in s.lower():
        print("Found relevant script tag length:", len(s))
        if len(s) < 2000:
            print(s[:500])

