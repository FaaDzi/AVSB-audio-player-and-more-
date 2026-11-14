import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.head-fi.org/showcase/my-er-audio-sliivo-slt6-6-balanced-armature-in-ear-earphones.27533/"
req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
try:
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
        print("Success! Length:", len(html))
        og = re.search(r'property="og:image" content="([^"]+)"', html)
        if og:
            print("OG Image:", og.group(1))
        imgs = re.findall(r'src="(https://www\.head-fi\.org/data/[^"]+)"', html)
        for im in imgs[:5]:
            print("Data img:", im)
except Exception as e:
    print("Error:", e)

