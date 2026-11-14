import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.iemranking.com/show/night-oblivion-butastur"
req = urllib.request.Request(url, headers={"User-Agent": UA})
try:
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
        print("Success! Length:", len(html))
        og = re.search(r'property="og:image" content="([^"]+)"', html)
        if og:
            print("OG Image:", og.group(1))
        imgs = re.findall(r'<img[^>]+src="([^">]+)"', html)
        print("Imgs found:", len(imgs))
        for im in imgs[:5]:
            print(" ", im)
except Exception as e:
    print("Error:", e)

