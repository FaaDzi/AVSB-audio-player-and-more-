import urllib.request
import ssl
import json

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for handle in ["earsonics-onyx-in-ear-monitors", "earsonics-onyx", "earsonics-onyx-universal-in-ear-monitors"]:
    url = f"https://audio46.com/products/{handle}.json"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            data = json.load(r)
            p = data["product"]
            print(f"SUCCESS Audio46: {p['title']}")
            for img in p["images"][:3]:
                print("  IMG:", img["src"])
            break
    except Exception as e:
        print(f"Error {handle}: {e}")

