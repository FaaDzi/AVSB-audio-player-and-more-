import urllib.request
import ssl

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# Test fetching with opener that handles cookies
opener = urllib.request.build_opener()
# First visit the article page to establish session/cookie
req1 = urllib.request.Request("https://www.headfonia.com/plussound-sonora-review/", headers={"User-Agent": UA})
with opener.open(req1) as r1:
    print("Article visited, status:", r1.status)

# Now fetch the image with referer
img_url = "https://www.headfonia.com/wp-content/uploads/2025/02/PlusSound-Sonora-1.jpg"
req2 = urllib.request.Request(img_url, headers={"User-Agent": UA, "Referer": "https://www.headfonia.com/plussound-sonora-review/"})
try:
    with opener.open(req2) as r2:
        data = r2.read()
        print("Success! Downloaded bytes:", len(data))
except Exception as e:
    print("Error:", e)

