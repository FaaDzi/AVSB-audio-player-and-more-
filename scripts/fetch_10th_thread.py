import urllib.request
import re

url = "https://www.head-fi.org/threads/penon-audio-10th-anniversary-commemorative-in-ear-monitor.967812/"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
with urllib.request.urlopen(req, timeout=10) as r:
    html = r.read().decode("utf-8", errors="ignore")

print("HTML length:", len(html))
# Find any URLs inside the page
urls = re.findall(r'https?://[^\s"\'<>]+', html)
for u in set(urls):
    if any(ext in u.lower() for ext in ['.jpg', '.png', '.webp', 'attachment', 'data/attachments']):
        print("Asset:", u)
