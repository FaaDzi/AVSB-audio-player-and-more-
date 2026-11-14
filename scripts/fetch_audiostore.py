import urllib.request
import re

url = "https://www.theaudiostore.in/blogs/reviews/penon-10th-anniversary-in-ear-monitors-review-a-perfect-all-rounder"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
    print("Length:", len(html))
    imgs = re.findall(r'https?://[^\s"\'<>]+\.(?:jpg|png|webp)', html)
    print("Found images:", len(imgs))
    for m in set(imgs):
        if "cdn.shopify.com" in m:
            print("  Shopify img:", m)
except Exception as e:
    print("Failed:", e)
