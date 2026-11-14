import urllib.request
import json

base_api = "https://penon-official.com/wp-json/wp/v2/media"
all_items = []
page = 1

while True:
    url = f"{base_api}?per_page=100&page={page}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            items = json.loads(r.read())
            if not items:
                break
            all_items.extend(items)
            print(f"Page {page}: {len(items)} items")
            page += 1
    except Exception as e:
        print(f"Page {page} finished or error: {e}")
        break

print(f"Total media items: {len(all_items)}")

candidates = []
for item in all_items:
    title = item.get("title", {}).get("rendered", "")
    src = item.get("source_url", "")
    t_lower = (title + " " + src).lower()
    if any(k in t_lower for k in ["10", "anni", "iem", "penon"]):
        candidates.append((title, src))

print(f"Matching candidates: {len(candidates)}")
for t, s in candidates:
    if any(k in (t + s).lower() for k in ["10", "anni"]):
        print("  10TH MATCH:", t, "->", s)
