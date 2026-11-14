import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.head-fi.org/showcase/my-er-audio-sliivo-slt6-6-balanced-armature-in-ear-earphones.27533/"
req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # find all img tags
    imgs = re.findall(r'<img[^>]+src="([^">]+)"', html)
    for im in imgs:
        if "avatar" not in im and "smilies" not in im and "badges" not in im:
            print("IMG:", im)

