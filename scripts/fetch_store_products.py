"""Download the public Shopify product feeds of IEM retailers (titles, URLs, image URLs).

Saves data/raw/stores/<store>.json. Images themselves are fetched later by
scripts/build_images.py, only for products matched to a measured IEM.

Usage: python -I scripts/fetch_store_products.py [--refresh]
"""
import json
import time
import urllib.error
import urllib.request
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "stores"
from stores import DOMAINS as STORES  # noqa: E402


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (iem-tournament personal project)"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 5:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 15 * (attempt + 1)
            print(f"  rate-limited, waiting {wait}s", flush=True)
            time.sleep(wait)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for store in STORES:
        dest = OUT / f"{store}.json"
        # --refresh re-downloads every feed (new products since the last run)
        if "--refresh" not in sys.argv and dest.exists() and '"variantPrices"' in dest.read_text(encoding="utf-8")[:20000]:
            print(f"{store}: already fetched")
            continue
        products, page = [], 1
        while True:
            batch = get_json(f"https://{store}/products.json?limit=250&page={page}")["products"]
            if not batch:
                break
            for p in batch:
                products.append({
                    "title": p["title"],
                    "type": p.get("product_type", ""),
                    "tags": p.get("tags", []),
                    "url": f"https://{store}/products/{p['handle']}",
                    "images": [i["src"] for i in p.get("images", [])[:3]],
                    # available variant prices, in the store's currency (all these stores sell in USD)
                    "variantPrices": sorted(float(v["price"]) for v in p.get("variants", [])
                                            if v.get("available", True) and v.get("price")),
                })
            page += 1
            time.sleep(1.0)
        (OUT / f"{store}.json").write_text(json.dumps(products, ensure_ascii=False, indent=0), encoding="utf-8")
        print(f"{store}: {len(products)} products")


if __name__ == "__main__":
    main()
