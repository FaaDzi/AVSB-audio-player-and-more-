import urllib.request
import ssl
import json

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://audio46.com/search/suggest.json?q=onyx&resources[type]=product"
req = urllib.request.Request(url, headers={"User-Agent": UA})
try:
    with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
        data = json.load(r)
        prods = data.get("resources", {}).get("results", {}).get("products", [])
        print("Results:", len(prods))
        for p in prods:
            print(" ", p.get("title"), "->", p.get("url"), p.get("image"))
except Exception as e:
    print("Error:", e)

