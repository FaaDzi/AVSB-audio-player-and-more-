import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://beyondthemusicid.com/products/canpur-jf1"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # find wix media
    keys = re.findall(r'([a-z0-9_]+~mv2\.(?:jpg|png|webp|jpeg))', html)
    print("Found keys for canpur-jf1:", len(keys))
    for k in set(keys):
        print("  Key:", k, "->", f"https://static.wixstatic.com/media/{k}")

