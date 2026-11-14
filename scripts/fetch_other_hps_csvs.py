import urllib.request
import re
from pathlib import Path

urls = [
    ("goldensound", "https://headphones.com/pages/goldensounds-headphone-ranking-list"),
    ("listener", "https://headphones.com/pages/listeners-headphone-ranking-list"),
    ("hps", "https://headphones.com/pages/hps-headphone-ranking-list")
]

for name, u in urls:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode('utf-8', errors='ignore')
            m = re.search(r"const\s+csvUrl\s*=\s*['\"]([^'\"]+)['\"]", html)
            if m:
                csv_u = m.group(1)
                print(f"{name} CSV URL: {csv_u}")
                with urllib.request.urlopen(urllib.request.Request(csv_u, headers={"User-Agent": "Mozilla/5.0"})) as cr:
                    cdata = cr.read().decode('utf-8', errors='ignore')
                    Path(f"data/raw/{name}_headphones.csv").write_text(cdata, encoding='utf-8')
                    print(f"  -> Saved data/raw/{name}_headphones.csv ({len(cdata.splitlines())} lines)")
    except Exception as e:
        print(f"{name} failed:", e)

