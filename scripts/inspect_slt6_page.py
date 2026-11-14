import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.head-fi.org/showcase/my-er-audio-sliivo-slt6-6-balanced-armature-in-ear-earphones.27533/"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # let's find any .jpg, .png, .webp
    all_imgs = re.findall(r'https?://[^\s"\'<>]+\.(?:jpg|png|webp)', html)
    print("Found total img links:", len(all_imgs))
    for im in set(all_imgs):
        print(im)

