import urllib.request
import ssl
import json
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# Let's search beyond the music for longinus
for path in ["products/night-oblivion-longinus", "product/night-oblivion-longinus", "night-oblivion-longinus"]:
    url = f"https://beyondthemusicid.com/{path}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            html = r.read().decode("utf-8", errors="ignore")
            print("SUCCESS:", url)
            og = re.search(r'property="og:image" content="([^"]+)"', html)
            if og:
                print("  OG:", og.group(1))
            imgs = re.findall(r'<img[^>]+src="([^">]+\.(?:jpg|png|webp))"', html)
            for im in imgs[:5]:
                print("  IMG:", im)
            break
    except Exception as e:
        print(f"Error {path}: {e}")

