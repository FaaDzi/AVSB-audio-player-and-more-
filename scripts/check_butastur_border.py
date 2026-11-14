import urllib.request
import ssl
from PIL import Image
import io
import numpy as np

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

for name, u in urls:
    req = urllib.request.Request(u, headers={"User-Agent": UA, "Referer": "https://head-fi.org"})
    with urllib.request.urlopen(req, context=ctx) as r:
        raw = r.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = np.asarray(img)
    # check border brightness/std
    border = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    mean_b = np.mean(border, axis=0)
    std_b = np.std(border, axis=0)
    print(f"{name}: border mean={mean_b.round(1)}, std={std_b.round(1)}")

