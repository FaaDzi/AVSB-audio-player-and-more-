import urllib.request
import ssl
import json
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://public-api.wordpress.com/wp/v2/sites/nobordersaudiophile.wordpress.com/posts?search=butastur"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    posts = json.load(r)
    for p in posts:
        if "BUTASTUR" in p.get("title", {}).get("rendered", ""):
            print("TITLE:", p["title"]["rendered"])
            content = p["content"]["rendered"]
            imgs = re.findall(r'src="(https://[^"]+\.(?:jpg|png|webp))"', content)
            print("Found images:", len(imgs))
            for im in imgs:
                print("  IMG:", im)
            text = re.sub(r'<[^>]+>', ' ', content)
            text = ' '.join(text.split())
            print("SNIPPET:", text[:500])

