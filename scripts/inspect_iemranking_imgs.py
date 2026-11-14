import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.iemranking.com/show/night-oblivion-butastur"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # let's find all img tags with full tag
    img_tags = re.findall(r'<img[^>]+>', html)
    for tag in img_tags:
        print(tag)

