import urllib.request
import re

url = "https://crinacle.com/rankings/headphones/"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        html = r.read().decode("utf-8", errors="ignore")
        print("Success! HTML length:", len(html))
        # Find table id
        tables = re.findall(r'<table[^>]*id="([^"]+)"', html)
        print("Found tables:", tables)
        with open("data/raw/crin_headphones.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("Saved to data/raw/crin_headphones.html")
except Exception as e:
    print("Fetch failed:", e)

