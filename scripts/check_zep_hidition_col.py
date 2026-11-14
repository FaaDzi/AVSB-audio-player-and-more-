import urllib.request
import ssl
import json

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for page in [1, 2]:
    url = f"https://zeppelinandco.com/collections/hidition/products.json?page={page}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            data = json.load(r)
            prods = data.get("products", [])
            print(f"Page {page}: {len(prods)} products")
            for p in prods:
                print("  ", p["title"], "->", [im["src"] for im in p["images"][:1]])
    except Exception as e:
        print(f"Error {page}: {e}")

