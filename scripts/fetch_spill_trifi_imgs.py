import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.spill.hk/headphones/headphone-review/jh-audio-trifi-review/"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")
    og = re.search(r'property="og:image" content="([^"]+)"', html)
    print("OG IMAGE:", og.group(1) if og else "")
    imgs = re.findall(r'<img[^>]+src="([^">]+)"', html)
    for im in imgs:
        if "article" in im:
            full_url = f"https://www.spill.hk{im}" if im.startswith("/") else im
            print("  Article img:", full_url)

