import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://sonicmantra.org/myer-audio-cklvx-d62-review/"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    imgs = re.findall(r'src="(https?://[^"]+\.(?:jpg|png|webp))"', html)
    for im in imgs:
        if "wp-content/uploads" in im or "zapwp.com" in im:
            print(im)

