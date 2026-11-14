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
            content = p["content"]["rendered"]
            # find figure and img captions
            figures = re.findall(r'<figure[^>]*>(.*?)</figure>', content, re.DOTALL)
            print("Figures:", len(figures))
            for fig in figures:
                src = re.search(r'src="([^"]+)"', fig)
                cap = re.search(r'<figcaption[^>]*>(.*?)</figcaption>', fig)
                print("  Fig:", src.group(1) if src else "", "->", cap.group(1) if cap else "")

