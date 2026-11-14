import urllib.request
import ssl
import json

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for page in range(1, 10):
    url = f"https://zeppelinandco.com/products.json?limit=250&page={page}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            data = json.load(r)
            prods = data.get("products", [])
            if not prods: break
            for p in prods:
                t = p["title"].lower()
                if "violet" in t or "hidition" in t:
                    print(f"MATCH: {p['title']} ({p['handle']}) -> {[im['src'] for im in p['images'][:1]]}")
    except Exception as e:
        print(f"Error {page}: {e}")
        break

