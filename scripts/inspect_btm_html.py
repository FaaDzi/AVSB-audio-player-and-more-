import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://beyondthemusicid.com/products/night-oblivion-longinus"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")
    print("Length:", len(html))
    title = re.search(r'<title>(.*?)</title>', html)
    print("Title:", title.group(1) if title else "")
    all_imgs = re.findall(r'<img[^>]+src="([^">]+)"', html)
    print("All imgs:", len(all_imgs))
    for im in all_imgs[:10]:
        print("  ", im)

