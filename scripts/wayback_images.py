"""Find photos for IEMs no current shop sells, using archived shop pages (Internet Archive).

1. For each shop, list every product page the Wayback Machine has archived (CDX API, one
   request per shop, cached in data/raw/wayback/).
2. Match product handles (e.g. "audiosense-dt200") to IEM models that still have no photo,
   with the same strict token rule as build_images.py.
3. Read the archived Shopify product data (<handle>.js / .json, else the page's og:image),
   take the first plain-background photo (live CDN first, archived copy as fallback),
   save a small WebP and remove a plain background.

Polite: about one request per second. Resumable: models already tried are skipped.
Output: app/public/data/images_archive.json (IEM id -> {src, store, url, title}).

Usage: python -I scripts/wayback_images.py [--max 300]
"""
import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
import numpy as np  # noqa: E402
from build_images import ACCESSORY, allowed_next, find, tokens  # noqa: E402
from clean_backgrounds import clean, plainness  # noqa: E402
from names import base  # noqa: E402
from stores import DOMAINS  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "wayback"
CATALOG = ROOT / "app" / "public" / "data" / "iems.json"
REVIEWS = ROOT / "app" / "public" / "data" / "reviews.json"
SHOP_IMAGES = ROOT / "app" / "public" / "data" / "images.json"
OUT = ROOT / "app" / "public" / "data" / "images_archive.json"
IMG_DIR = ROOT / "app" / "public" / "img" / "iem"
REJECTED = ROOT / "data" / "images_rejected.txt"  # "shop/handle" lines checked by eye as wrong photos
SHOPS = DOMAINS  # brand shops first, then retailers
# A brand's own shop often leaves the brand out of the page address ("campfireaudio.com/products/andromeda-10"),
# so there the model name is also matched without these brand prefixes.
BRAND_PREFIX = {
    "kiwiears.com": ["kiwi ears"], "letshuoer.net": ["letshuoer", "shuoer"], "tangzu.net": ["tangzu"],
    "ziigaat.com": ["ziigaat"], "www.thieaudio.com": ["thieaudio"], "www.tripowin.com": ["tripowin"],
    "www.hisenior-iem.com": ["hisenior"], "www.nicehck.com": ["nicehck"], "epzaudio.com": ["epz"],
    "www.campfireaudio.com": ["campfire audio", "campfire"], "www.64audio.com": ["64 audio"],
    "www.etymotic.com": ["etymotic"], "www.westoneaudio.com": ["westone audio", "westone"],
    "www.kineraaudio.com": ["kinera"], "fatfreq.com": ["fatfreq"], "www.hiby.com": ["hiby"],
}
SKIP_HANDLE = re.compile(r"reservation|deposit|card|cable|tips|eartip|case|pouch|adapter|filter|nozzle|bundle|combo|preorder|pre-order", re.I)
SIZE = 200
DELAY = 1.1


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "iem-tournament personal project (wayback lookups)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 403):
                return None
            time.sleep(5 * (i + 1))
        except Exception:
            time.sleep(5 * (i + 1))
    return None


def handles(shop):
    """Archived product handles of a shop (cached)."""
    cache = RAW / f"{shop}.txt"
    if not cache.exists():
        body = get(f"http://web.archive.org/cdx/search/cdx?url={shop}/products/&matchType=prefix&collapse=urlkey"
                   f"&fl=original&filter=statuscode:200&limit=50000") or b""
        time.sleep(DELAY)
        hs = set()
        for line in body.decode("utf-8", "replace").splitlines():
            m = re.search(r"/products/([^/?#.]+)", line)
            if m:
                hs.add(m.group(1).lower())
        RAW.mkdir(parents=True, exist_ok=True)
        cache.write_text("\n".join(sorted(hs)), encoding="utf-8")
    return [h for h in cache.read_text(encoding="utf-8").split() if h]


def model_variants(shop, model_tokens):
    """The model's tokens, plus (on the brand's own shop) the same without the brand."""
    out = [model_tokens]
    for b in BRAND_PREFIX.get(shop, []):
        bt = tokens(b)
        if model_tokens[:len(bt)] == bt and len(model_tokens) > len(bt):
            out.append(model_tokens[len(bt):])
            break
    return out


def match_handle(model_tokens, ht):
    """ht: the handle's tokens (same splitting as titles, so "bl03" == "bl-03")."""
    i = find(ht, model_tokens)
    if i < 0 or (i > 0 and ht[i - 1] in ("for", "with", "compatible")):  # "tips-for-<model>" is an accessory
        return False
    nxt = ht[i + len(model_tokens)] if i + len(model_tokens) < len(ht) else None
    return allowed_next(nxt)


def snapshot(url):
    """Raw archived copy of url (latest 200 snapshot), or None."""
    body = get(f"http://web.archive.org/cdx/search/cdx?url={urllib.parse.quote(url, safe='/:')}"
               f"&filter=statuscode:200&fl=timestamp&limit=-1")
    time.sleep(DELAY)
    if not body or not body.strip():
        return None, None
    ts = body.decode().split()[-1]
    raw_url = f"http://web.archive.org/web/{ts}id_/{url}"
    data = get(raw_url)
    time.sleep(DELAY)
    return data, f"https://web.archive.org/web/{ts}/{url.removesuffix('.js').removesuffix('.json')}"


def product_images(shop, handle):
    """Image URLs from the archived product data, plus the archived page URL."""
    for suffix in (".js", ".json"):
        data, page = snapshot(f"{shop}/products/{handle}{suffix}")
        if data:
            try:
                j = json.loads(data)
                p = j.get("product", j)
                imgs = [i if isinstance(i, str) else i.get("src") for i in p.get("images", [])]
                imgs = ["https:" + u if u and u.startswith("//") else u for u in imgs if u]
                if imgs:
                    return imgs[:3], page, p.get("title", handle)
            except Exception:
                pass
    data, page = snapshot(f"{shop}/products/{handle}")
    if data:
        m = re.search(rb'property="og:image"\s+content="([^"]+)"', data) or re.search(rb'content="([^"]+)"\s+property="og:image"', data)
        if m:
            u = m.group(1).decode()
            return ["https:" + u if u.startswith("//") else u], page, handle
    return [], None, None


def fetch_image(url):
    sized = url + ("&" if "?" in url else "?") + f"width={SIZE * 2}"
    for u in (sized, f"http://web.archive.org/web/0id_/{url}"):
        data = get(u)
        time.sleep(0.3)
        if data:
            try:
                img = Image.open(io.BytesIO(data))
                img.load()
                return img
            except Exception:
                continue
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=300, help="max models to look up this run")
    ap.add_argument("--shops", help="comma-separated shops to search (default: all)")
    ap.add_argument("--retry", action="store_true", help="look again at models earlier marked 'no archived page'")
    args = ap.parse_args()
    iems = json.loads(CATALOG.read_text(encoding="utf-8"))["iems"]
    have = set(json.loads(SHOP_IMAGES.read_text(encoding="utf-8")))
    found = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    tried_file = RAW / "tried.json"
    tried = json.loads(tried_file.read_text(encoding="utf-8")) if tried_file.exists() else {}
    rv = json.loads(REVIEWS.read_text(encoding="utf-8"))
    reviewed = set(rv.get("reviews", {})) | set(rv.get("comments", {})) | set(rv.get("videos", {}))

    models = {}
    for i in iems:
        b = base(i["name"])
        m = models.setdefault(b, {"ids": [], "reviewed": False, "sources": 0})
        m["ids"].append(i["id"])
        m["reviewed"] |= i["id"] in reviewed
        m["sources"] = max(m["sources"], len(i["sources"]))
    todo = [(n, m) for n, m in models.items()
            if not any(x in have or x in found for x in m["ids"]) and (n not in tried or (args.retry and tried[n] == "no archived page")) and len(tokens(n)) >= 2]
    todo.sort(key=lambda nm: (not nm[1]["reviewed"], -nm[1]["sources"], nm[0]))
    print(f"{len(todo)} models without a photo to look up; doing up to {args.max}", flush=True)

    shops = args.shops.split(",") if args.shops else SHOPS
    # tokenise every handle once (tens of thousands of them)
    shop_handles = {s: [(h, tokens(h)) for h in handles(s) if not SKIP_HANDLE.search(h)] for s in shops}
    print("archived product handles:", {s: len(h) for s, h in shop_handles.items()}, flush=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    rejected = {ln.strip() for ln in REJECTED.read_text(encoding="utf-8").splitlines()
                if ln.strip() and not ln.startswith("#")} if REJECTED.exists() else set()
    hits = 0
    for n, m in todo[: args.max]:
        t = tokens(n)
        result = "no archived page"
        for shop in shops:
            cands = [h for h, ht in shop_handles[shop] if f"{shop}/{h}" not in rejected
                     and any(match_handle(v, ht) for v in model_variants(shop, t))]
            if not cands:
                continue
            handle = min(cands, key=len)  # the plainest handle is usually the main product
            imgs, page, title = product_images(shop, handle)
            if not imgs or ACCESSORY.search(title or ""):
                continue
            choice = None
            for u in imgs:
                img = fetch_image(u)
                if img is None:
                    continue
                transparent = "A" in img.getbands() or "transparency" in img.info
                img = img.convert("RGBA" if transparent else "RGB")
                img.thumbnail((SIZE, SIZE))
                if transparent or plainness(np.asarray(img.convert("RGB"))) >= 0.85:
                    choice = img
                    break
                choice = choice or img
            if choice is None:
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")
            dest = IMG_DIR / f"{slug}.webp"
            choice.save(dest, "WEBP", quality=70, method=6)
            clean(dest)
            for i in m["ids"]:
                found[i] = {"src": f"img/iem/{slug}.webp", "store": f"{shop} (archived)", "url": page, "title": title}
            result = f"{shop}/{handle}"
            hits += 1
            break
        tried[n] = result
        tried_file.write_text(json.dumps(tried, indent=0, ensure_ascii=False), encoding="utf-8")
        OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{n}: {result}", flush=True)
    print(f"done: {hits} new photos this run; {len({v['src'] for v in found.values()})} archive photos in total", flush=True)


if __name__ == "__main__":
    main()
