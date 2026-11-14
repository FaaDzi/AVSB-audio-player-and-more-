import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
}

url = "https://twister6.com/2022/05/26/plussound-sonora/"
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
        html = r.read().decode("utf-8", errors="ignore")
        print("SUCCESS Twister6! Length:", len(html))
        imgs = re.findall(r'<img[^>]+src="([^">]+\.(?:jpg|png|webp))"', html)
        print("Imgs found:", len(imgs))
        for im in imgs[:5]:
            print("  IMG:", im)
except Exception as e:
    print("Error:", e)

