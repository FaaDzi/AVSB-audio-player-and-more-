import urllib.request
import ssl
from PIL import Image
import io

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

urls = [
    "https://cdn.head-fi.org/a/12260117.jpg",
    "https://cdn.head-fi.org/a/12260121.jpg",
    "https://cdn.head-fi.org/a/12260122.jpg",
    "https://cdn.head-fi.org/a/12260124.jpg",
    "https://cdn.head-fi.org/a/12260125.jpg",
    "https://cdn.head-fi.org/a/12260126.jpg",
]

for u in urls:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA, "Referer": "https://head-fi.org"})
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            data = r.read()
            img = Image.open(io.BytesIO(data))
            print(f"SUCCESS: {u} -> size: {img.size}, format: {img.format}, bytes: {len(data)}")
    except Exception as e:
        print(f"FAIL: {u} -> {e}")

