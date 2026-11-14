import urllib.request
import ssl
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.dmag.com.hk/categories/canpur"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # find product blocks
    prods = re.findall(r'<a[^>]+href="([^"]+/products/[^"]+)"[^>]*>(.*?)</a>', html, re.DOTALL)
    print("Found product links:", len(prods))
    seen = set()
    for link, body in prods:
        if link not in seen:
            seen.add(link)
            img = re.search(r'src="([^"]+)"', body)
            title = re.search(r'title="([^"]+)"', body) or re.search(r'>([^<]+)<', body)
            print(f"Link: {link}")
            if img: print(f"  Img: {img.group(1)}")
            if title: print(f"  Title: {title.group(1).strip()}")

