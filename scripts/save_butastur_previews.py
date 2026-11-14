import urllib.request
import ssl
from PIL import Image
import io
from pathlib import Path

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

urls = [
    ("12260117", "https://cdn.head-fi.org/a/12260117.jpg"),
    ("12260121", "https://cdn.head-fi.org/a/12260121.jpg"),
    ("12260122", "https://cdn.head-fi.org/a/12260122.jpg"),
    ("12260124", "https://cdn.head-fi.org/a/12260124.jpg"),
    ("12260125", "https://cdn.head-fi.org/a/12260125.jpg"),
    ("12260126", "https://cdn.head-fi.org/a/12260126.jpg"),
]

out_dir = Path("data/raw/butastur_check")
out_dir.mkdir(parents=True, exist_ok=True)

for name, u in urls:
    req = urllib.request.Request(u, headers={"User-Agent": UA, "Referer": "https://head-fi.org"})
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        raw = r.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    img.thumbnail((300, 300))
    img.save(out_dir / f"{name}.jpg", "JPEG", quality=80)
    print(f"Saved {name}.jpg")

