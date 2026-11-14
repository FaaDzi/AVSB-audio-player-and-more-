import urllib.request
import ssl
import json

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

for post_id in ["1c76o04", "1c4uofj"]:
    url = f"https://www.reddit.com/comments/{post_id}.json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            data = json.load(r)
            post = data[0]["data"]["children"][0]["data"]
            print(f"=== Post {post_id}: {post.get('title')} ===")
            print("  URL:", post.get("url"))
            print("  Thumbnail:", post.get("thumbnail"))
            media_metadata = post.get("media_metadata", {})
            for mid, mval in media_metadata.items():
                print("  Media:", mid, mval.get("s", {}).get("u"))
            print("  Selftext snippet:", post.get("selftext", "")[:300])
    except Exception as e:
        print(f"Error {post_id}: {e}")

