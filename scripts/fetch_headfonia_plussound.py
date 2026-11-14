import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for slug in ["plussound-sonora-review", "plussound-volta-review"]:
    url = f"https://www.headfonia.com/{slug}/"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            html = r.read().decode("utf-8", errors="ignore")
            og = re.search(r'property="og:image" content="([^"]+)"', html)
            print(f"=== {slug} ===")
            if og: print("  OG:", og.group(1))
            imgs = re.findall(r'<img[^>]+src="([^">]+\.(?:jpg|png|webp))"', html)
            for im in imgs:
                if any(k in im.lower() for k in ["sonora", "volta", "plussound"]):
                    print("  IMG:", im)
    except Exception as e:
        print(f"Error {slug}: {e}")

