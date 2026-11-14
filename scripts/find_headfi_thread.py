import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.head-fi.org/search/2/?q=The+Myer+Audio+Thread&t=post&c[title_only]=1&o=relevance"
req = urllib.request.Request(url, headers={"User-Agent": UA})
try:
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
        threads = re.findall(r'href="(/threads/[^"]+)"', html)
        for t in set(threads):
            print("Found thread:", t)
except Exception as e:
    print("Error:", e)

