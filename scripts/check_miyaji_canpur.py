import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# Let's search Miyaji shop for canpur
url = "https://shop.miyaji.co.jp/SHOP/list.php?Search=canpur"
req = urllib.request.Request(url, headers={"User-Agent": UA})
try:
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        html = r.read().decode("euc-jp", errors="ignore")
        print("Success Miyaji! Length:", len(html))
        # look for img src
        imgs = re.findall(r'<img[^>]+src="([^">]+canpur[^">]*)"', html, re.I)
        print("Canpur imgs:", len(imgs))
        for im in imgs:
            print("  ", im)
        links = re.findall(r'href="([^"]+canpur[^"]*)"', html, re.I)
        for l in links[:5]:
            print("  Link:", l)
except Exception as e:
    print("Miyaji error:", e)

