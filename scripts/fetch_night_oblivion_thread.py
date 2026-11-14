import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for page in [1, 2]:
    url = f"https://www.head-fi.org/threads/night-oblivion-uranium-thread-new-longinus.969333/page-{page}" if page > 1 else "https://www.head-fi.org/threads/night-oblivion-uranium-thread-new-longinus.969333/"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            html = r.read().decode("utf-8", errors="ignore")
            imgs = re.findall(r'https?://[^\s"\'<>]+\.(?:jpg|png|webp)', html)
            print(f"Page {page} images found: {len(imgs)}")
            for im in set(imgs):
                if any(k in im for k in ["cdn.head-fi.org/a/", "attachments", "penon"]):
                    print("  ATTACHMENT:", im)
    except Exception as e:
        print(f"Page {page} error: {e}")

