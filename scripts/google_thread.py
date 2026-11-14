import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

req = urllib.request.Request("https://www.google.com/search?q=site:head-fi.org/threads+%22The+Myer+Audio+Thread%22", headers={"User-Agent": UA})
try:
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        html = r.read().decode("utf-8", errors="ignore")
        m = re.findall(r'https://www\.head-fi\.org/threads/[a-z0-9\-]+\.([0-9]+)/?', html)
        print("Thread IDs:", m)
        urls = re.findall(r'(https://www\.head-fi\.org/threads/[^"&<]+)', html)
        for u in set(urls):
            print("Thread URL:", u)
except Exception as e:
    print("Google search error:", e)

