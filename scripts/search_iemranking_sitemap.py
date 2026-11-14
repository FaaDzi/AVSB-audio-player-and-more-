import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

req = urllib.request.Request("https://www.iemranking.com/sitemap.xml", headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
    xml = r.read().decode("utf-8", errors="ignore")
    urls = re.findall(r'<loc>([^<]+)</loc>', xml)
    print("Total URLs in sitemap:", len(urls))
    targets = ["slt6", "butastur", "longinus", "canpur", "cklvx", "sliivo", "azul", "hisenior", "audiosense", "geek-wold", "raptgo", "prisma", "viento", "traillii", "onyx", "aur-audio"]
    for u in urls:
        for t in targets:
            if t in u.lower():
                print(f"[{t}] {u}")

