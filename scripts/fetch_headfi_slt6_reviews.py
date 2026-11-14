import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.head-fi.org/showcase/my-er-audio-sliivo-slt6-6-balanced-armature-in-ear-earphones.27533/reviews"
req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
try:
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
        # Look for attachment images or lbImage
        imgs = re.findall(r'(https://[^\s"\'<>]+\.(?:jpg|png|webp))', html)
        for im in set(imgs):
            if "attachment" in im or "media" in im or "cdn.head-fi.org" in im:
                if "static" not in im:
                    print("Found:", im)
        links = re.findall(r'href="(/showcase/review/[^"]+)"', html)
        print("Review links:", links)
except Exception as e:
    print("Error:", e)

