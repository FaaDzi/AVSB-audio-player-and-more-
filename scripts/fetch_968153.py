import urllib.request
import re

url = "https://www.head-fi.org/threads/penon-10th-anniversary.968153/"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
    # find all cdn.head-fi.org/a/ or image links
    imgs = re.findall(r'https?://[^\s"\'<>]+\.(?:jpg|png|webp)', html)
    print("Found images:", len(imgs))
    for img in set(imgs):
        if "cdn.head-fi.org/a/" in img:
            print("  HF image:", img)
except Exception as e:
    print("Failed:", e)
