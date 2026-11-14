import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for path in ["rpm/canpur/", "canpur/", "rpm/canpur/joyfull.php", "rpm/canpur/joyfull1.php"]:
    url = f"https://www.miyaji.co.jp/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            html = r.read().decode("utf-8", errors="ignore")
            print(f"SUCCESS: {url} (len {len(html)})")
            imgs = re.findall(r'<img[^>]+src="([^">]+\.(?:jpg|png|webp))"', html)
            for im in imgs:
                print("  IMG:", im)
    except Exception as e:
        print(f"Error {path}: {e}")

