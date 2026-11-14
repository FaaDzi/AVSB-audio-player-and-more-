import urllib.request
import re

url = "https://nobordersaudiophile.wordpress.com/2023/07/26/penon-10th-anniversary-review-lush-holographic-musicality-with-a-pinch-of-est-spice/"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
    imgs = re.findall(r'https?://[^\s"\'<>]+\.(?:jpg|png|webp)', html)
    print("Found images:", len(imgs))
    for m in set(imgs):
        if "wp.com" in m or "wordpress" in m:
            print("  WP img:", m)
except Exception as e:
    print("Failed:", e)
