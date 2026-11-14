import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for path in ["sitemap.xml", "robots.txt", ""]:
    url = f"https://iemranking.com/{path}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            text = r.read().decode("utf-8", errors="ignore")
            print(f"=== {url} ({len(text)} bytes) ===")
            print(text[:300])
    except Exception as e:
        print(f"Error {path}: {e}")

