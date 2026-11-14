import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://nobordersaudiophile.wordpress.com/2024/01/09/night-oblivion-butastur-review-the-iem-solution-for-those-that-cant-afford-64audio-u18t/"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # find all wp.com images
    imgs = re.findall(r'src="(https://[^"]+\.wp\.com/[^"]+\.(?:jpg|png|webp))"', html)
    print("Found images:", len(imgs))
    for im in set(imgs):
        print("  IMG:", im)
    # also extract concluding verdict or summary
    paras = re.findall(r'<p>(.*?)</p>', html, re.DOTALL)
    print("Paras count:", len(paras))
    for p in paras:
        clean_p = re.sub(r'<[^>]+>', '', p).strip()
        if any(k in clean_p.lower() for k in ["conclusion", "verdict", "pros", "overall", "sound signature"]):
            print("  PARAGRAPH:", clean_p[:200])

