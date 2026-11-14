"""Helper to add/clean a single IEM image from a URL or local file."""
import http.cookiejar
import io
import json
import re
import ssl
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from clean_backgrounds import clean, plainness

IMG_DIR = ROOT / "app" / "public" / "img" / "iem"
SEARCH_JSON = ROOT / "app" / "public" / "data" / "images_search.json"
SIZE = 200
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def add_image(iem_id: str, image_url: str, source_name: str, source_url: str, title: str = ""):
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", iem_id.lower()).strip("-")
    dest = IMG_DIR / f"{slug}.webp"

    raw = None
    netloc = urllib.parse.urlparse(image_url).netloc
    headers = {
        "User-Agent": UA,
        "Referer": source_url if source_url else f"https://{netloc}/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }
    
    # Try 1: standard opener with cookies
    try:
        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        if source_url:
            try:
                opener.open(urllib.request.Request(source_url, headers={"User-Agent": UA}), timeout=10)
            except Exception:
                pass
        with opener.open(urllib.request.Request(image_url, headers=headers), timeout=20) as r:
            raw = r.read()
    except Exception:
        pass
        
    # Try 2: unverified ssl context
    if not raw:
        try:
            ctx = ssl._create_unverified_context()
            cj = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(cj))
            if source_url:
                try:
                    opener.open(urllib.request.Request(source_url, headers={"User-Agent": UA}), timeout=10)
                except Exception:
                    pass
            with opener.open(urllib.request.Request(image_url, headers=headers), timeout=20) as r:
                raw = r.read()
        except Exception as e:
            print(f"Failed to download {image_url}: {e}")
            return False

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        print(f"Failed to open image {image_url}: {e}")
        return False

    transparent = "A" in img.getbands() or "transparency" in img.info
    
    if not transparent:
        # Smart autocrop if object is centered on a wide plain background
        rgb_arr = np.asarray(img.convert("RGB"))
        if plainness(rgb_arr) >= 0.85:
            border = np.concatenate([rgb_arr[0], rgb_arr[-1], rgb_arr[:, 0], rgb_arr[:, -1]])
            bg = np.median(border, axis=0)
            diff = np.linalg.norm(rgb_arr.astype(np.int16) - bg.astype(np.int16), axis=2)
            obj_pixels = np.argwhere(diff > 25)
            if len(obj_pixels) > 0:
                y0, x0 = obj_pixels.min(axis=0)
                y1, x1 = obj_pixels.max(axis=0)
                pad_x = max(4, int((x1 - x0) * 0.08))
                pad_y = max(4, int((y1 - y0) * 0.08))
                x0 = max(0, x0 - pad_x)
                y0 = max(0, y0 - pad_y)
                x1 = min(img.width, x1 + pad_x)
                y1 = min(img.height, y1 + pad_y)
                img = img.crop((x0, y0, x1, y1))

    img = img.convert("RGBA" if transparent else "RGB")
    img.thumbnail((SIZE, SIZE))
    
    # Save as WebP
    img.save(dest, "WEBP", quality=75, method=6)
    
    # Clean background if not transparent
    if not transparent:
        clean(dest)

    # Update images_search.json
    data = {}
    if SEARCH_JSON.exists():
        try:
            data = json.load(open(SEARCH_JSON, encoding="utf-8"))
        except Exception:
            pass

    data[iem_id] = {
        "src": f"img/iem/{slug}.webp",
        "store": source_name,
        "url": source_url,
        "title": title or iem_id,
    }

    SEARCH_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Successfully added image for {iem_id} ({dest.stat().st_size // 1024} KB)")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("Usage: python add_iem_image.py <iem_id> <image_url> <source_name> <source_url> [title]")
        sys.exit(1)
    add_image(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else "")
