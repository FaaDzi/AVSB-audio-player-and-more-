import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://beyondthemusicid.com/products/night-oblivion-longinus"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # find all wixstatic media keys: [a-z0-9_]+~mv2\.(?:jpg|png|webp|jpeg)
    media_keys = re.findall(r'([a-z0-9_]+~mv2\.(?:jpg|png|webp|jpeg))', html)
    print("Found media keys:", len(media_keys))
    for mk in set(media_keys):
        print("  Key:", mk, "->", f"https://static.wixstatic.com/media/{mk}")

