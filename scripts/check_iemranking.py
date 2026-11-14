import urllib.request
import ssl
import json
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# Let's test searching iemranking.com
for slug in ["slt6", "myer-audio-sliivo-slt6", "night-oblivion-butastur", "butastur"]:
    url = f"https://iemranking.com/iem/{slug}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            html = r.read().decode("utf-8", errors="ignore")
            print(f"SUCCESS: {url} (len {len(html)})")
            og = re.search(r'property="og:image" content="([^"]+)"', html)
            if og:
                print("  OG:", og.group(1))
            imgs = re.findall(r'src="([^"]+\.(?:png|jpg|webp))"', html)
            for im in imgs[:5]:
                print("  IMG:", im)
    except Exception as e:
        print(f"{slug} -> {e}")

