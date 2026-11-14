import urllib.request
import json
import ssl
import re
import sys
from pathlib import Path

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def search_penon(query):
    url = f"https://penonaudio.com/index.php?route=product/search&search={urllib.parse.quote(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
            html = r.read().decode("utf-8", errors="ignore")
            # Look for product thumbnails: https://penonaudio.com/image/cache/...
            links = re.findall(r'href="(https://penonaudio.com/[^"]+product_id=[^"]+)"', html)
            imgs = re.findall(r'src="(https://penonaudio.com/image/[^"]+)"', html)
            return {"links": links, "imgs": imgs}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "butastur"
    print(f"Searching Penon for {q}...")
    res = search_penon(q)
    print(json.dumps(res, indent=2))

