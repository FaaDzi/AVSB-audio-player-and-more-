import urllib.request
import re
from pathlib import Path

url = "https://headphones.com/pages/resolves-headphone-ranking-list"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        html = r.read().decode("utf-8", errors="ignore")
        print("Success! HTML length:", len(html))
        Path("data/raw/resolve_rankings.html").write_text(html, encoding="utf-8")
        print("Saved to data/raw/resolve_rankings.html")
except Exception as e:
    print("Fetch failed:", e)

