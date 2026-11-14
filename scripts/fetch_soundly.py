import urllib.request
import re

url = 'https://soundlymusical.com/2023/05/30/penon-10th-anniversary-review/'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        html = r.read().decode('utf-8', errors='ignore')
    imgs = re.findall(r'https?://[^\s"\'<>]+\.(?:jpg|png|webp)', html)
    print('Found images:', len(imgs))
    for m in set(imgs):
        if 'soundlymusical' in m:
            print(m)
except Exception as e:
    print('Failed:', e)
