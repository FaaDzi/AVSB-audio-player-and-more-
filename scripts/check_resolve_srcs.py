import re
from pathlib import Path

html = Path("data/raw/resolve_rankings.html").read_text(encoding="utf-8")
srcs = re.findall(r'<script[^>]*src="([^"]+)"', html)
for s in srcs:
    if "rank" in s.lower() or "list" in s.lower() or "custom" in s.lower() or "app" in s.lower():
        print("Script:", s)

