import urllib.request
import re
import json

urls = {
    "penon-serial": "https://penonaudio.com/penon-serial.html",
    "penon-fan-2": "https://penonaudio.com/penon-fan-2.html",
    "penon-10th-anniversary": "https://penonaudio.com/penon-10th-anniversary-iem.html"
}

results = {}

for key, target_url in urls.items():
    api = f"https://archive.org/wayback/available?url={target_url}"
    req = urllib.request.Request(api, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            avail = json.loads(r.read())
        snapshot = avail.get("archived_snapshots", {}).get("closest", {}).get("url")
        if not snapshot:
            print(f"No snapshot for {key}")
            continue
        print(f"{key} snapshot: {snapshot}")
        
        req_page = urllib.request.Request(snapshot, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req_page, timeout=15) as r:
            html = r.read().decode("utf-8", errors="ignore")
        
        # match image urls
        matches = re.findall(r'(?:src|href)=["\']([^"\']+\.(?:jpg|png|webp))["\']', html)
        images = []
        for m in matches:
            if "PENON" in m.upper() or "10TH" in m.upper() or "SERIAL" in m.upper() or "FAN" in m.upper():
                full_url = m
                if full_url.startswith("//"):
                    full_url = "https:" + full_url
                elif not full_url.startswith("http"):
                    full_url = f"http://web.archive.org{full_url}"
                images.append(full_url)
        
        images = list(set(images))
        results[key] = {
            "snapshot": snapshot,
            "images": images
        }
        print(f"Found {len(images)} images for {key}:")
        for img_url in images[:6]:
            print("  ", img_url)
    except Exception as e:
        print(f"Error for {key}: {e}")
