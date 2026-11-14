from pathlib import Path

html = Path("data/raw/resolve_rankings.html").read_text(encoding="utf-8")
pos = html.find('fetch(', 376017)
if pos != -1:
    print("Found fetch( at", pos)
    print("Code around fetch:\n", html[pos-100:pos+800])
else:
    print("fetch( not found, searching for script tags after 376017...")
    import re
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', html[376017:], re.S)
    for i, s in enumerate(scripts):
        print(f"Script {i} length:", len(s))
        print("Preview:\n", s[:500])

