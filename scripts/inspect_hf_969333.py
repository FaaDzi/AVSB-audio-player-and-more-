import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.head-fi.org/threads/night-oblivion-uranium-thread-new-longinus.969333/"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # let's look for attachments
    atts = re.findall(r'href="([^"]*attachment[^"]*)"', html)
    print("Attachments:", atts)
    # look for bbImage or message-body img
    imgs = re.findall(r'<img[^>]+src="([^">]+)"', html)
    for im in imgs:
        print("IMG:", im)

