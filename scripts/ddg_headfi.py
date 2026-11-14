import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# Let's search duckduckgo html
url = "https://html.duckduckgo.com/html/?q=site:head-fi.org/threads+%22The+Myer+Audio+Thread%22"
req = urllib.request.Request(url, headers={"User-Agent": UA})
try:
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
        urls = re.findall(r'href="(https?://www\.head-fi\.org/threads/[^"&]+)', html)
        for u in set(urls):
            print("Found thread URL:", u)
except Exception as e:
    print("Error:", e)

