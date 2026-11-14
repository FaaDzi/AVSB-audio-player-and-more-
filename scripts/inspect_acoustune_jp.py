import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

req = urllib.request.Request("https://www.acoustune.jp/", headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")
    links = re.findall(r'href="([^"]+)"', html)
    print("Links found:", len(links))
    for l in set(links):
        if "rs-one" in l.lower() or "rsone" in l.lower() or "rs_one" in l.lower() or "monitor" in l.lower():
            print("  Match link:", l)
    # also search for text mentioning RS ONE
    pos = html.lower().find("rs one")
    if pos != -1:
        print("RS ONE context:", html[pos-100:pos+300])

