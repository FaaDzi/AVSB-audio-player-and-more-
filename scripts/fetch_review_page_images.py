import sys, urllib.request, re, io
from PIL import Image
import numpy as np

sys.path.insert(0, "scripts")
from clean_backgrounds import plainness

if len(sys.argv) < 2:
    print("Usage: python fetch_review_page_images.py <URL>")
    sys.exit(1)

url = sys.argv[1]
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
}
req = urllib.request.Request(url, headers=headers)
html = urllib.request.urlopen(req, timeout=10).read().decode("utf-8", errors="ignore")

imgs = set(re.findall(r'https?://[^\s"\'<>]+\.(?:jpg|png|webp)', html))
print(f"Total images found on page: {len(imgs)}")

for img_url in sorted(imgs):
    # filter out icons, logos, banners
    if any(k in img_url.lower() for k in ["logo", "avatar", "icon", "banner", "author", "gravatar", "emoji"]):
        continue
    try:
        r = urllib.request.Request(img_url, headers=headers)
        raw = urllib.request.urlopen(r, timeout=8).read()
        im = Image.open(io.BytesIO(raw))
        w, h = im.size
        if w < 300 or h < 300:
            continue
        p = plainness(np.asarray(im.convert("RGB")))
        print(f"[{p:.2f}] {w}x{h} -> {img_url}")
    except Exception:
        pass

