import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for slug in ["canpur-joyfull-1", "canpur-joyful-1", "canpur-jf1", "canpur-joyfull", "canpur"]:
    url = f"https://beyondthemusicid.com/products/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            html = r.read().decode("utf-8", errors="ignore")
            print(f"SUCCESS: {url}")
            mks = re.findall(r'([a-z0-9_]+~mv2\.(?:jpg|png|webp|jpeg))', html)
            for mk in set(mks)[:3]:
                print("  IMG:", f"https://static.wixstatic.com/media/{mk}")
    except Exception as e:
        pass

