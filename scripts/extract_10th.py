import urllib.request
import re

url = 'http://web.archive.org/web/20240301040153/https://penonaudio.com/penon-audio-10th-anniversary-iem.html'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=15) as r:
    html = r.read().decode('utf-8', errors='ignore')

imgs = re.findall(r'https?://[^\s"\'<>]+\.(?:jpg|png|webp)', html)
for img in set(imgs):
    print(img)
