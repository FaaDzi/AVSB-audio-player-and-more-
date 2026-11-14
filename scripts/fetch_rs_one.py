import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.acoustune.jp/product/rs-one"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")
    mks = re.findall(r'([a-z0-9_]+~mv2\.(?:jpg|png|webp|jpeg))', html)
    print("Media keys found:", len(mks))
    for mk in list(set(mks))[:10]:
        print("  Key:", mk, "->", f"https://static.wixstatic.com/media/{mk}")

