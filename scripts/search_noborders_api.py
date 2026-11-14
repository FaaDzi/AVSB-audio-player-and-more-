import urllib.request
import ssl
import json

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for q in ["butastur", "longinus", "night oblivion", "slt6", "cklvx"]:
    url = f"https://public-api.wordpress.com/wp/v2/sites/nobordersaudiophile.wordpress.com/posts?search={urllib.parse.quote(q)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            posts = json.load(r)
            print(f"=== Query '{q}': {len(posts)} posts ===")
            for p in posts:
                print("  Title:", p.get("title", {}).get("rendered"))
                print("  Link:", p.get("link"))
                print("  Featured media URL:", p.get("jetpack_featured_media_url"))
    except Exception as e:
        print(f"Error {q}: {e}")

