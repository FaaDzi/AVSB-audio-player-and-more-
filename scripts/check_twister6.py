import urllib.request
import ssl
import json
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for q in ["sonora", "volta"]:
    url = f"https://twister6.com/wp-json/wp/v2/posts?search={q}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            posts = json.load(r)
            print(f"=== Twister6 {q}: {len(posts)} posts ===")
            for p in posts:
                print("  Title:", p["title"]["rendered"])
                content = p["content"]["rendered"]
                imgs = re.findall(r'src="(https://[^"]+\.(?:jpg|png|webp))"', content)
                for im in imgs[:2]:
                    print("    IMG:", im)
    except Exception as e:
        print(f"Error {q}: {e}")

