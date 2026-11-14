import urllib.request
import ssl
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.acoustune.jp/product/rs-one"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")
    tags = re.findall(r'<img[^>]+>', html)
    for t in tags:
        if "mv2" in t:
            alt = re.search(r'alt="([^"]*)"', t)
            src = re.search(r'src="([^"]+)"', t)
            if src:
                print("IMG tag:", alt.group(1) if alt else "", "->", src.group(1)[:120])

