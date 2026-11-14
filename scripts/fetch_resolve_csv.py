import urllib.request
from pathlib import Path

csv_url = 'https://cdn.shopify.com/s/files/1/1791/0383/files/AndrewHeadphones.csv?v=1786071932'
req = urllib.request.Request(csv_url, headers={"User-Agent": "Mozilla/5.0"})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read().decode('utf-8', errors='ignore')
        Path("data/raw/resolve_headphones.csv").write_text(data, encoding='utf-8')
        lines = data.strip().split('\n')
        print(f"Success! Downloaded {len(lines)} lines from AndrewHeadphones.csv")
        print("Header:", lines[0])
        print("Sample row 1:", lines[1] if len(lines) > 1 else "")
        print("Sample row 2:", lines[2] if len(lines) > 2 else "")
except Exception as e:
    print("Download failed:", e)

