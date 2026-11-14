import urllib.request
import ssl
import json

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://beyondthemusicid.com/products/night-oblivion-longinus.json"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    data = json.load(r)
    p = data["product"]
    print("Title:", p["title"])
    for img in p["images"]:
        print("IMG:", img["src"])

