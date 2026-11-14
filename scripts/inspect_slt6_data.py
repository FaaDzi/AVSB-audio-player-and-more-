import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.head-fi.org/showcase/my-er-audio-sliivo-slt6-6-balanced-armature-in-ear-earphones.27533/"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # let's search for any src or href containing /data/ or /attachments/
    matches = re.findall(r'(?:src|href|content)=["\']([^"\']*(?:attachment|item|cover|showcase|data)[^"\']*)["\']', html)
    print("Found matches:", len(matches))
    for m in set(matches):
        print(m)

