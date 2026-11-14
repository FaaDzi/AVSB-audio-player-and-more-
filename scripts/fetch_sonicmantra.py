import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

paths = [
    "myer-audio-cklvx-d62-review",
    "cklvx-d62-review",
    "myer-audio-cklvx-d62",
    "cklvx-d62",
    "sliivo-slt6",
    "myer-audio-sliivo-slt6-review",
    "sliivo-slt6-review"
]

for p in paths:
    url = f"https://sonicmantra.org/{p}/"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            html = r.read().decode("utf-8", errors="ignore")
            print(f"SUCCESS: {url}")
            og = re.search(r'property="og:image" content="([^"]+)"', html)
            if og:
                print("  OG IMAGE:", og.group(1))
            imgs = re.findall(r'src="(https?://sonicmantra\.org/wp-content/uploads/[^"]+\.(?:jpg|png|webp))"', html)
            for im in imgs[:3]:
                print("  IMG:", im)
    except Exception as e:
        print(f"FAIL {p}: {e}")

