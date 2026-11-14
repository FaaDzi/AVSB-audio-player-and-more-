import urllib.request
import json
import ssl

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for page in [1, 2, 3]:
    url = f"https://hangout.audio/products.json?limit=250&page={page}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            data = json.load(r)
            prods = data.get("products", [])
            print(f"Page {page}: {len(prods)} products")
            for p in prods:
                title = p.get("title", "")
                handle = p.get("handle", "")
                imgs = [im.get("src") for im in p.get("images", [])]
                if any(k in title.lower() for k in ["myer", "cklvx", "sliivo", "slt6", "d62", "d41", "butastur", "night", "longinus", "canpur", "oriolus", "hidition", "acoustune"]):
                    print(f"  MATCH: {title} ({handle}) -> {len(imgs)} imgs: {imgs[:1]}")
    except Exception as e:
        print(f"Page {page} error: {e}")

