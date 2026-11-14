import urllib.request
import json

base_api = "https://penon-official.com/wp-json/wp/v2/media"

for search in ["10th", "anniversary", "serial", "fan"]:
    url = f"{base_api}?search={search}&per_page=20"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            items = json.loads(r.read())
            print(f"=== Search: {search} (found {len(items)}) ===")
            for item in items:
                title = item.get("title", {}).get("rendered", "")
                src = item.get("source_url", "")
                print(f"  {title} -> {src}")
    except Exception as e:
        print(f"Error {search}: {e}")
