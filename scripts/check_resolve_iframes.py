import re
from pathlib import Path

html = Path("data/raw/resolve_rankings.html").read_text(encoding="utf-8")
iframes = re.findall(r'<iframe[^>]*src="([^"]+)"', html)
print("iframes:", iframes)

# Check all links containing airtable, google, notion, or cdn
links = re.findall(r'href="([^"]+)"', html)
embed_links = [l for l in links if any(k in l for k in ["airtable", "docs.google", "notion", "sheets", "ranking"])]
print("embed links:", embed_links)

# Also check for tablepress or similar div classes
divs = re.findall(r'<div[^>]*class="([^"]+)"', html)
print("div classes containing table or rank:", [d for d in divs if "table" in d or "rank" in d])

