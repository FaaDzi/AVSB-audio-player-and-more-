import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for path in ["headphones/headphone-review/jh-audio-trifi-review/", "audiovisual/jh-audio-trifi/"]:
    url = f"https://www.spill.hk/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            html = r.read().decode("utf-8", errors="ignore")
            print(f"SUCCESS: {url}")
            imgs = re.findall(r'<img[^>]+src="([^">]+\.(?:jpg|png|webp))"', html)
            for im in imgs[:5]:
                print("  IMG:", im)
            break
    except Exception as e:
        print(f"Error {path}: {e}")

