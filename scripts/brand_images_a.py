"""Photos for group-a IEMs (mostly budget Chinese brands) that the shop feeds and the
Wayback pass did not cover.

Why they were missed before: the measured names carry unit/tip/switch suffixes
("RUMBA Stock Wide", "Castor Bass 0011", "x JAY ESTRELLA AZLA SEDNA LIGHT"), and some
brands sell from their own shops that stores.py does not list.

1. Reduce each name to its core model: drop tuning-switch codes, "Stock", ear-tip / nozzle /
   filter names, unit counters, tip-colour words (a variant may use its base model's photo;
   version words like "Pro", "2", "II", "Ultra" are kept and must match exactly).
2. Match the core model against product titles of the cached shop feeds (data/raw/stores)
   plus extra brand/retail Shopify feeds fetched here (cached in data/raw/brand_a/stores):
   brand words must appear in the title (except on the brand's own shop) and the model words
   must appear contiguously, followed only by a generic word (build_images.allowed_next).
3. Still missing: archived product pages of the brand shops (Wayback CDX, cached).
4. Take the first plain-background photo (of up to 3), 200 px WebP, plain background removed.

Input: data/raw/brand_a/missing_group_a.json ({BRAND: {base name: [ids]}}).
Output: app/public/data/images_brand_a.json (IEM id -> {src, store, url, title}).

Usage: python -I scripts/brand_images_a.py [--no-wayback]
"""
import argparse
import io
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
import numpy as np  # noqa: E402
from build_images import ACCESSORY, SPEC, allowed_next, find, tokens  # noqa: E402
from clean_backgrounds import clean, plainness  # noqa: E402
from stores import DOMAINS  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "brand_a"
INPUT = RAW / "missing_group_a.json"
OUT = ROOT / "app" / "public" / "data" / "images_brand_a.json"
IMG_DIR = ROOT / "app" / "public" / "img" / "iem"
SIZE = 200
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
# a few brand sites serve an incomplete certificate chain; only public product data is read
CTX = ssl._create_unverified_context()

# extra Shopify feeds: (domain, brand group it belongs to, or None for a retailer)
EXTRA = [
    ("ccaaudio.com", "CCA"),
    ("www.nfacous.com", "NF"),
    ("juzearaudio.com", "JUZEAR"),
    ("www.zeppelinandco.com", None),
]
BRAND_SHOP = {"kiwiears.com": "KIWI", "ziigaat.com": "ZIIGAAT", "www.nicehck.com": "NICEHCK",
              "epzaudio.com": "EPZ", **{d: b for d, b in EXTRA if b}}
WAYBACK_SHOPS = ["ccaaudio.com", "www.nfacous.com", "juzearaudio.com", "ziigaat.com", "kiwiears.com",
                 "epzaudio.com", "www.nicehck.com", "linsoul.com", "hifigo.com", "shenzhenaudio.com"]

BRANDS = {
    "ZIIGAAT": ["ziigaat"], "KZ": ["kz"], "NF": ["nf acous", "nf audio", "nfaudio", "nf"], "TRN": ["trn"],
    "KIWI": ["kiwi ears"], "XENNS": ["xenns", "mangird"], "PENON": ["penon"], "CCA": ["cca"],
    "EPZ": ["epz"], "IMR": ["imr acoustics", "imr"], "JUZEAR": ["juzear"], "KBEAR": ["kbear"],
    "NICEHCK": ["nicehck"], "YANYIN": ["yanyin"], "ISN": ["isn audio", "isn"], "GS": ["gs audio"],
    "SMABAT": ["smabat"], "TANSIO": ["tansio mirai", "tansio", "tsmr"], "BLON": ["blon", "wgzblon"],
}

# Hand-checked core names where the rules below can't tell (typos, collab names, duplicates).
OVERRIDE = {
    "Kiwi Ears Haylcon": "Kiwi Ears Halcyon",
    "Xenns Mangrid Tea PRO": "Xenns Tea Pro",
    "Juzear x Z Reviews Defiant": "Juzear x ZEOS DEFIANT",
    "Yanyin Cannon Pro up": "Yanyin Cannon Pro",
    "Yanyin Canon 2": "Yanyin Cannon 2",
    "KZ Krilla": "KZ Krila",
    "KZ Lin Long": "KZ Ling Long",
    "Tansio Mirai TSM ARMOR": "Tansio Mirai Armor",
    "Tansio Mirai X 10th Anniversary": "Tansio Mirai X 10th AE",
    "EPZ EPZ x Tipsy Star One": "EPZ Star One",
    "EPZ x Tipsy Star & One": "EPZ Star One",
    "EPZ x Tipsy Star One 300 MESH": "EPZ Star One",
    "KZ KZ CASTOR ALL ON 500 MESH": "KZ Castor",
    "KZ symphony with 310 impedance": "KZ Symphony",
    "Penon 10th Anniversary IEM": "Penon 10th Anniversary",
    "Kiwi Ears x Crinacle Singolo 2nd Unit": "Kiwi Ears Singolo",
}
# Names left alone: unclear what they are (mods, samples, unit numbers that may be versions).
SKIP = {"Kiwi Ears Prison Mike Mod", "Penon Penon Sample", "Penon Penon sample 3", "XENNS Top PRO 1",
        "XENNS Top PRO 2", "Blon BL03 2", "KZ CRN/ZEX Pro", "Smabat M0 + Super Point", "EPZ P50 Custom",
        "XENNS Mangird Tea Pro 2024", "KZ ZS5v1", "Juzear x ZEOS DEFIANT GAMING CLEAR", "Juzear x ZEOS DEFIANT GAMING STOCK"}

TIPS = (r"azla sedna\b.*|softears ultra ?clear|ultra ?clear|ultraclear|sancai\b.*|divinus\b.*|spintfit\b.*"
        r"|clarion|bgvp\b.*|tanya filter|\d+ mesh|final audio type e.*|stock( tips)?|tips"
        r"|\w+ nozzle|n\.\s?(black|blue|gold|gray|grey|green|purple|red|silver)|new unit|old unit"
        r"|(2nd|3rd|\d+th) unit|2nd|3rd|all on|all off|on[- ]off|[01u]{4}|\d{4} switch|switch")
COLOURS = r"(black|clear|white|red|blue|yellow|pink|gold|silver|gray|grey|green|purple|wide|regular|red/white)"


def core(name: str) -> str | None:
    if name in SKIP:
        return None
    if name in OVERRIDE:
        return OVERRIDE[name]
    s = re.sub(r"\(.*$", "", name)                      # "(Final Audio Type E eartips" etc.
    s = re.sub(r"(?i)^ziigaat x jay estrella\b.*", "ZiiGaat Estrella", s)
    s = re.sub(rf"(?i)\b({TIPS})(?=\s|$)", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    while True:                                          # trailing colour / fit words (tips, shells)
        t = re.sub(rf"(?i)\s+{COLOURS}$", "", s)
        if t == s:
            break
        s = t
    return s.strip()


def roman(tok):
    return {"ii": "2", "iii": "3", "iv": "4"}.get(tok, tok)


def norm(toks):
    """Token list for matching: roman numerals as digits, the 'Mangird' prefix dropped, and a
    collab 'x' dropped ("KZ x HBB PR2"), but not a model's own X ("Vibe X", "Sonata X 1DD")."""
    toks = [roman(t) for t in toks if t != "mangird"]
    return [t for i, t in enumerate(toks)
            if t != "x" or (i + 1 < len(toks) and allowed_next(toks[i + 1])) or i + 1 == len(toks)]


def get(url, tries=3, raw=False):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40, context=CTX) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 403, 410):
                return None
            time.sleep(5 * (i + 1))
        except Exception:
            time.sleep(5 * (i + 1))
    return None


def feed(domain):
    cache = RAW / "stores" / f"{domain}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    out, page = [], 1
    while page < 40:
        body = get(f"https://{domain}/products.json?limit=250&page={page}")
        time.sleep(1.1)
        batch = json.loads(body)["products"] if body else []
        if not batch:
            break
        for p in batch:
            out.append({"title": p["title"], "url": f"https://{domain}/products/{p['handle']}",
                        "images": [i["src"] for i in p.get("images", [])[:3]]})
        page += 1
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{domain}: {len(out)} products", flush=True)
    return out


def split(group, name):
    """(brand token lists, model tokens) for a core name."""
    t = norm(tokens(name))
    for b in sorted(BRANDS[group], key=lambda b: -len(tokens(b))):
        bt = tokens(b)
        if t[:len(bt)] == bt:
            t = t[len(bt):]
            break
    while t[:1] == ["audio"] or t[:1] == ["acoustics"]:
        t = t[1:]
    return [tokens(b) for b in BRANDS[group]], t


def title_match(brands, model, title_toks, own_shop):
    """Brand in the title (unless it's the brand's own shop), model words contiguous near the
    start, followed by a generic word, and no accessory word right around the model
    ("KZ Castor Upgrade Cable"); long SEO titles ("... In-Ear Headphone, cable included") are fine."""
    tt = norm(title_toks)
    if model and model[-1].isdigit():  # "BL07 DD" is tokenised "bl 07dd": split the spec unit off again
        tt = [x for t in tt for x in ((model[-1], t[len(model[-1]):]) if t != model[-1] and t.startswith(model[-1])
                                       and SPEC.match(t) and t[len(model[-1]):].isalpha() else (t,))]
    if not own_shop and not any(find(tt, b) >= 0 for b in brands):
        return False
    i = find(tt, model)
    if i < 0 or i > 7 or (i > 0 and tt[i - 1] in ("for", "with", "compatible")):
        return False
    nxt = tt[i + len(model)] if i + len(model) < len(tt) else None
    window = " ".join(tt[:i + len(model) + 3])
    return allowed_next(nxt) and not ACCESSORY.search(window)


def fetch_image(url, archived=False):
    urls = [url if "web.archive.org" in url else url + ("&" if "?" in url else "?") + f"width={SIZE * 2}"]
    if archived:
        urls.append(f"http://web.archive.org/web/0id_/{url}")
    for u in urls:
        data = get(u)
        time.sleep(0.5)
        if data:
            try:
                img = Image.open(io.BytesIO(data))
                img.load()
                return img
            except Exception:
                continue
    return None


REJECTED = set()  # product pages or image URLs (without query) checked by eye as wrong


def pick(images, archived=False, limit=3):
    """First of up to 3 photos with a plain (or transparent) background, as a 200 px image."""
    for u in images[:limit]:
        if u.split("?")[0] in REJECTED:
            continue
        img = fetch_image(u, archived)
        if img is None:
            continue
        transparent = "A" in img.getbands() or "transparency" in img.info
        img = img.convert("RGBA" if transparent else "RGB")
        img.thumbnail((SIZE, SIZE))
        if transparent or plainness(np.asarray(img.convert("RGB"))) >= 0.85:
            return img
    return None


def slug_for(core_name):
    slug = re.sub(r"[^a-z0-9]+", "-", core_name.lower()).strip("-")
    if (IMG_DIR / f"{slug}.webp").exists():
        slug += "-a"
    n = 2
    while (IMG_DIR / f"{slug}.webp").exists():   # never overwrite a photo (other agents write "-b"/"-c")
        slug = f"{slug.rsplit('-a', 1)[0]}-a{n}"
        n += 1
    return slug


# ---- Wayback ----
def wb_handles(shop):
    cache = RAW / "wayback" / f"{shop}.txt"
    old = ROOT / "data" / "raw" / "wayback" / f"{shop}.txt"   # lists already fetched by wayback_images.py
    if not cache.exists() and old.exists():
        return [h for h in old.read_text(encoding="utf-8").split() if h]
    if not cache.exists():
        body = get(f"http://web.archive.org/cdx/search/cdx?url={shop}/products/&matchType=prefix&collapse=urlkey"
                   f"&fl=original&filter=statuscode:200&limit=50000") or b""
        time.sleep(1.1)
        hs = {m.group(1).lower() for m in re.finditer(r"/products/([^/?#.\s]+)", body.decode("utf-8", "replace"))}
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text("\n".join(sorted(hs)), encoding="utf-8")
    return [h for h in cache.read_text(encoding="utf-8").split() if h]


def snapshot(url):
    body = get(f"http://web.archive.org/cdx/search/cdx?url={urllib.parse.quote(url, safe='/:')}"
               f"&filter=statuscode:200&fl=timestamp&limit=-1")
    time.sleep(1.1)
    if not body or not body.strip():
        return None, None
    ts = body.decode().split()[-1]
    data = get(f"http://web.archive.org/web/{ts}id_/{url}")
    time.sleep(1.1)
    return data, f"https://web.archive.org/web/{ts}/{url.removesuffix('.js')}"


def snapshot_html(url):
    """Latest archived copy of a page that isn't a bot-wall placeholder ("One moment, please...")."""
    body = get(f"http://web.archive.org/cdx/search/cdx?url={urllib.parse.quote(url, safe='/:')}"
               f"&filter=statuscode:200&fl=timestamp&limit=-6")
    time.sleep(1.1)
    for ts in reversed((body or b"").decode().split()):
        data = get(f"http://web.archive.org/web/{ts}id_/{url}")
        time.sleep(1.1)
        html = (data or b"").decode("utf-8", "replace")
        if html and not re.search(r"One moment, please|Just a moment|cf-challenge|challenge-platform", html[:20000]):
            return html, f"https://web.archive.org/web/{ts}/{url}"
    return "", None


def wb_product(shop, handle):
    data, page = snapshot(f"{shop}/products/{handle}.js")
    if data:
        try:
            p = json.loads(data)
            imgs = [i if isinstance(i, str) else i.get("src") for i in p.get("images", [])]
            imgs = ["https:" + u if u and u.startswith("//") else u for u in imgs if u]
            return imgs[:3], page, p.get("title", handle)
        except Exception:
            pass
    return [], None, None


# ---- brand sites that aren't Shopify: product pages from the sitemap, photo from og:image ----
SITEMAP_SITES = {"kz-audio.com": "KZ", "isnaudio.com": "ISN", "tansio-mirai.com": "TANSIO"}


def sitemap_pages(site):
    cache = RAW / "sitemaps" / f"{site}.txt"
    if not cache.exists():
        body = get(f"https://{site}/sitemap.xml") or b""
        time.sleep(1.1)
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body.decode("utf-8", "replace"))
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text("\n".join(locs), encoding="utf-8")
    return [u for u in cache.read_text(encoding="utf-8").split() if u]


def page_photo(url):
    """(og:title or <title>, [og:image]) of a page, cached."""
    cache = RAW / "pages2" / (re.sub(r"[^a-z0-9]+", "_", url.lower())[-120:] + ".json")
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    html = (get(url) or b"").decode("utf-8", "replace")
    time.sleep(1.1)
    t = re.search(r'property="og:title"\s+content="([^"]+)"', html) or re.search(r"<title>([^<]+)</title>", html)
    imgs = re.findall(r'property="og:image"\s+content="([^"]+)"', html) +         re.findall(r'content="([^"]+)"\s+property="og:image"', html)
    # plus large photos linked from the page (Tansio's gallery "..._1000x1000_fit.jpg")
    imgs += [i for i in re.findall(r'(?:src|href|data-src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"', html)
             if not re.search(r"favicon|logo|icon|_160x160|banner", i, re.I)]
    imgs = list(dict.fromkeys(urllib.parse.urljoin(url, i) for i in imgs))
    out = [t.group(1).strip() if t else "", imgs[:6]]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def sitemap_stage(group, core_name, brands, model, rejected):
    for site, g in SITEMAP_SITES.items():
        if g != group:
            continue
        cands = []
        for u in sitemap_pages(site):
            slug = urllib.parse.unquote(u.rstrip("/").rsplit("/", 1)[-1]).removesuffix(".html")
            if u not in rejected and title_match(brands, model, tokens(slug), True):
                cands.append((len(tokens(slug)), u))
        for _, u in sorted(cands)[:2]:
            title, imgs = page_photo(u)
            if not imgs:
                continue
            img = pick(imgs, limit=6)
            if img:
                return img, site, u, title or core_name
    return None


# ---- penonaudio.com (OpenCart retailer behind a bot wall): archived product pages ----
def penon_handles():
    cache = RAW / "wayback" / "penonaudio.com.cdx"
    if not cache.exists():
        body = get("http://web.archive.org/cdx/search/cdx?url=penonaudio.com/&matchType=prefix&collapse=urlkey"
                   "&fl=original&filter=statuscode:200&limit=200000") or b""
        time.sleep(1.1)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(body)
    out = {}
    for u in cache.read_text(encoding="utf-8", errors="replace").split():
        if re.search(r"/image/|/catalog/|\?|/accessories/", u):
            continue
        h = u.rstrip("/").rsplit("/", 1)[-1].removesuffix(".html")
        if h and not re.search(r"cable|tips|case|module|damper|adapter|filter", h, re.I):
            if h.lower() not in out or u.endswith(".html"):  # the .html address has the older, cleaner copies
                out[h.lower()] = u
    return out


_FOLDERS = {}


def penon_archived_images(urls):
    """penonaudio.com resizes photos on demand ("name-700x700.jpg"); the archive often has only other
    sizes of the same photo. For each photo, the largest archived size between 200 and 700 px."""
    out = []
    for u in urls:
        m = re.match(r"(https?://(?:www\.)?penonaudio\.com/image/cache/.*/)([^/]+?)-\d+x\d+w?\.(jpe?g|png)$", u)
        if not m:
            continue
        folder, name = m.group(1), m.group(2).lower()
        if folder not in _FOLDERS:
            q = re.sub(r"^https?://(www\.)?", "", folder)
            body = get(f"http://web.archive.org/cdx/search/cdx?url={q}&matchType=prefix&fl=original"
                       f"&filter=statuscode:200&collapse=urlkey&limit=2000") or b""
            time.sleep(1.1)
            _FOLDERS[folder] = body.decode("utf-8", "replace").split()
        sizes = []
        for o in _FOLDERS[folder]:
            mm = re.search(r"/([^/]+?)-(\d+)x\d+w?\.(?:jpe?g|png)$", o)
            if mm and mm.group(1).lower() == name and 200 <= int(mm.group(2)) <= 700:
                sizes.append((int(mm.group(2)), o))
        if sizes:
            out.append(f"http://web.archive.org/web/0id_/{max(sizes)[1]}")
    return list(dict.fromkeys(out))


def penon_stage(group, brands, model, rejected):
    hs = penon_handles()
    own = group == "PENON"
    cands = sorted((len(h), h) for h in hs if title_match(brands, model, tokens(h), own))
    for _, h in cands[:2]:
        url = hs[h]
        if url in rejected:
            continue
        cache = RAW / "pages2" / ("penon_" + re.sub(r"[^a-z0-9]+", "_", h) + ".json")
        if cache.exists():
            title, imgs, page = json.loads(cache.read_text(encoding="utf-8"))
        else:
            html, page = snapshot_html(url)
            t = re.search(r'property="og:title"\s+content="([^"]+)"', html) or re.search(r"<title>([^<]+)</title>", html)
            title = t.group(1).strip() if t else ""
            imgs = re.findall(r'property="og:image"\s+content="([^"]+)"', html)
            # the main zoom photo of the product (OpenCart image cache, largest size)
            imgs += re.findall(r'(?:href|src|data-zoom-image)="(https?://(?:www\.)?penonaudio\.com/image/cache/catalog/[^"]+-(?:[5-9]\d\d|1\d\d\d)x\d+w?\.(?:jpe?g|png))"', html)
            imgs = list(dict.fromkeys(i.replace(" ", "%20") for i in imgs))[:6]
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps([title, imgs, page], ensure_ascii=False), encoding="utf-8")
        if not imgs or (title and not title_match(brands, model, tokens(title), own)):
            continue
        # only photos whose file or folder names the model (not e.g. the brand's shared box shot)
        key = "".join(model)
        imgs = [i for i in imgs if key in re.sub(r"[^a-z0-9]", "", urllib.parse.unquote(i).lower())]
        img = pick(penon_archived_images(imgs), limit=4)
        if img:
            return img, "penonaudio.com (archived)", page, title or h
    return None


# Archived pages found by hand for models the automatic stages can't name-match
# (title checked: the page is that exact model).
KNOWN_PAGES = {
    "imr elan+": "penonaudio.com/imr-elan.html",                     # page title "IMR ELAN+"
    # "imr ozar": archived og:image is an illustration, not the IEM
    "imr acoustics na-le": "imracoustics.com/collections/instock/products/na-le-hybrid",
}


# Photos picked by eye from the full product galleries (the feeds keep only the first 3 photos,
# and many names don't title-match: "Canon" vs "Cannon", series words, 【】 titles).
# core name -> (store, product page, title, photo URL). Checked: exact model, plain light background.
MANUAL = {
    "imr ozar": ("imracoustics.com (archived)", "https://web.archive.org/web/20241205131855/https://imracoustics.com/products/imr-ozar", "IMR Ozar",
        "https://cdn.shopify.com/s/files/1/2230/9199/products/custom_resized_5c1ab1a7-5b3e-4b62-b8d1-9b62f4a4a3f8.jpg"),
    "imr elan+": ("penonaudio.com (archived)", "https://web.archive.org/web/20250320045722/penonaudio.com/imr-elan.html", "IMR ELAN+",
        "http://web.archive.org/web/20230320191249id_/https://penonaudio.com/image/cache/catalog/IMR/ELEN+/imr-elan-420x420.jpg"),
    # the bass version of the Castor is the black one (kz-audio.com: "Harman Target with Improved Bass Version")
    "kz castor bass": ("kz-audio.com", "https://kz-audio.com/kz-castor.html", "KZ Castor (Improved Bass Version, black)",
        "https://kz-audio.com/images/kz-castor-12-01.webp"),
    "kz castor improved bass version": ("kz-audio.com", "https://kz-audio.com/kz-castor.html", "KZ Castor (Improved Bass Version, black)",
        "https://kz-audio.com/images/kz-castor-12-01.webp"),
    # Vader comes as Balanced (glossy black) and High-Resolution (gunmetal) versions of the same shell
    "kz vader balanced": ("linsoul.com", "https://linsoul.com/products/kz-vader", "KZ Vader",
        "https://cdn.shopify.com/s/files/1/0040/7201/3924/files/340ee771d4111e3c377fa114a7b7407e.jpg"),
    "juzear nimbus": ("juzearaudio.com", "https://juzearaudio.com/products/juzear-poise-series-nimbus-warm-balanced-single-dynamic-driver-in-ear-monitors", "JUZEAR POISE Series Nimbus Warm-Balanced Single Dynamic Driver In-Ear Monitors",
        "https://cdn.shopify.com/s/files/1/0712/5011/6773/files/2.jpg"),
    "juzear light shuttle": ("juzearaudio.com", "https://juzearaudio.com/products/juzear-unveil-series-light-shuttle", "JUZEAR UNVEIL Series Light Shuttle Natural Vocal Triple Hybrid IEMs",
        "https://cdn.shopify.com/s/files/1/0712/5011/6773/files/DSC05350.jpg"),
    "yanyin cannon pro": ("linsoul.com", "https://linsoul.com/products/yanyin-canon-pro", "Yanyin Canon Pro",
        "https://cdn.shopify.com/s/files/1/0040/7201/3924/files/IMG_8668.jpg"),
    "yanyin cannon 2": ("linsoul.com", "https://linsoul.com/products/yanyin-canon-ii", "Yanyin Canon II",
        "https://cdn.shopify.com/s/files/1/0040/7201/3924/files/IMG_9734.jpg"),
    "yanyin cannon ii": ("linsoul.com", "https://linsoul.com/products/yanyin-canon-ii", "Yanyin Canon II",
        "https://cdn.shopify.com/s/files/1/0040/7201/3924/files/IMG_9734.jpg"),
    "kbear rosefinch": ("keephifi.com", "https://keephifi.com/products/kbear-rosefinch", "【KBEAR Rosefinch】Biological Diaphragm DD in-Ear Monitor HiFi Wired Earbuds for Game/Live",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/2_c75f65e9-6913-4c40-961a-49a3322ee59a.jpg"),
    "kbear ormosia": ("keephifi.com", "https://keephifi.com/products/kbear-ormosia-in-ear-monitors-with-chinese-traditional-charm-10mm-dd-composite-ba-iem-headphones", "【KBEAR Ormosia——Clearance】10mm DD+Composite BA IEM Headphones in Ear Monitors with Chinese Traditional Charm",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/10_bd477716-e264-4aa4-86fd-440937341997.jpg"),
    "kbear kb08 mirage": ("keephifi.com", "https://keephifi.com/products/kbear-mirage-kb08-in-ear-monitors-1-dd-1-ba-2-micro-planar-magnetic-drivers-hifi-in-ear-earphones-3-5mm-no-mic", "【KBEAR Mirage KB08】in Ear Monitors 1 DD · 1 BA · 2 Micro-Planar Magnetic Drivers HiFi in Ear Earphones 3.5mm No Mic",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/2_8b1f3087-acbf-4647-bb31-40dcff460120.jpg"),
    "kbear voyages sr-8": ("keephifi.com", "https://keephifi.com/products/kbear-voyages-sr-8-1dd-3ba-hybrid-hifi-in-ear-earphones-iem-headphones", "【KBEAR Voyages SR-8——Clearance】1DD+3BA Hybrid HiFi In Ear Earphones IEM Headphones",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/1_348454f9-1493-41f1-9553-6c1b34428dbe.jpg"),
    "kbear tourbillon-pro tb-pro": ("keephifi.com", "https://keephifi.com/products/kbear-tourbillon-pro-in-ear-earphones-10mm-dd-hifi-in-ear-earphone-pu-peek-dlc-composite-diaphragm-hifi-in-ear-monitor-headphone", "【KBEAR  TB-Pro】Flagship 10MM PU+PEEK+DLC Composite Diaphragm DD in Ear Monitor Headphone, VGP Award Winner",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/3_671337c4-ab04-466b-899e-dffd7ec98fd4.png"),
    "kbear kb03": ("keephifi.com", "https://keephifi.com/products/kbear-alkaid-kb03-in-ear-monitors-1-dd-1-ba-1-bone-conduction-hybrid-hifi-iem-earphones-upgraded-vibration-bone-conduction-driver", "【KBEAR Alkaid KB03——Discontinued】1 DD+1 BA+1 Bone Conduction Hybrid HiFi IEM Earphones",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/371a9eb351470bfb47a1cc01a4b8dc63_1a09152f-8566-40d6-80a0-36b025938196.jpg"),
    "kbear kb16 cepheus": ("keephifi.com", "https://keephifi.com/products/kbear-cepheus-kb16-upgraded-2dd-6ba-hybird-drivers-hifi-in-ear-monitor-earphones-iem-for-audiophile-musician-dj-stage", "【KBEAR Cepheus KB16】Upgraded 2DD+6BA Hybird Drivers HiFi in ear Monitor Earphones IEM",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/996c0314d3c9f4f6a92e228ed4c8e264_aa4f5659-89e0-49ce-8654-58103a8198e9.jpg"),
    "kbear kb02": ("keephifi.com", "https://keephifi.com/products/kbear-kb02", "【KBEAR KB02】Beryllium-plated Dynamic Driver Super Bass Bone Conduction in Ear Monitor Headphones",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/1_e92f033c-f79c-4d92-ad2b-872a27ac18e1.jpg"),
    "kbear stellar": ("keephifi.com", "https://keephifi.com/products/kbear-stellar-1dd-hifi-earbud-headphone-wired-earphone-stereo-headset-compatible-with-tablets-android-phone-mp3-player", "【KBEAR Stellar】 15.4mm 1DD HiFi Earbud Headphone",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/files/1_de2ad694-1bd2-46dd-a1b7-e7d8bbd5686c.jpg"),
    "kbear pecker": ("keephifi.com", "https://keephifi.com/products/kbear-pecker", "【KBEAR Pecker——Clearance】HiFi 2BA+1DD Driver Earphones In-Ear Metal Monitor IEM",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/products/01_51d8dec6-1d37-4feb-b9dc-c2257877a2bc.jpg"),
    "kbear lark": ("keephifi.com", "https://keephifi.com/products/kbear-lark", "【KBEAR Lark】 1DD + 1BA In Ear Headphone Best Wired Earbuds In ear Monitors HIFI Earphones Headset",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/products/17_5b93c42a-b4ff-417c-bf56-d9d5374a648d.jpg"),
    "kbear ks2": ("keephifi.com", "https://keephifi.com/products/kbear-ks2", "【KBEAR KS2——Clearance】1BA 1DD Hybrid in Ear Monitor Headphones Stereo Bass HiFi IEM Earphone",
        "https://cdn.shopify.com/s/files/1/0266/1587/3582/products/9_4c42243a-f7f6-4d00-b9fa-8534d37d699e.jpg"),
    "epz g20": ("epzaudio.com", "https://epzaudio.com/products/epz-g20-gaming-earbuds-with-detachable-boom-mic", "EPZ G20 Gaming IEMs",
        "https://cdn.shopify.com/s/files/1/0588/4025/2488/files/G20-GRAY-3.png"),
    "epz g10": ("epzaudio.com", "https://epzaudio.com/products/epz-g10-wired-gaming-iems-earbuds-fps-positioning", "EPZ G10 Gaming IEMs",
        "https://cdn.shopify.com/s/files/1/0588/4025/2488/files/G10-IEMS-MAIN-02.png"),
    "xenns tea pro se": ("www.bloomaudio.com", "https://www.bloomaudio.com/products/xenns-mangird-tea-pro-se", "Xenns Mangird Tea Pro SE | Special Edition Hybrid Universal IEMs",
        "https://cdn.shopify.com/s/files/1/0023/9255/5595/files/tea-pro-se-thumb-two.webp"),
    "xenns mangird tea pro se": ("www.bloomaudio.com", "https://www.bloomaudio.com/products/xenns-mangird-tea-pro-se", "Xenns Mangird Tea Pro SE | Special Edition Hybrid Universal IEMs",
        "https://cdn.shopify.com/s/files/1/0023/9255/5595/files/tea-pro-se-thumb-two.webp"),
    "xenns top": ("www.audio46.com", "https://www.audio46.com/products/xenns-mangird-top-universal-in-ear-monitor", "Xenns Mangird Top Universal In-Ear Monitors",
        "https://cdn.shopify.com/s/files/1/0065/4432/6771/products/IMG_1123_6a2263c5-67e7-4655-beef-5758046e0271.png"),
    "xenns up": ("www.audio46.com", "https://www.audio46.com/products/mangird-xenns-up-universal-in-ear-monitor", "Xenns Mangird UP Electrostatic Universal In-Ear Monitors",
        "https://cdn.shopify.com/s/files/1/0065/4432/6771/products/Mangird-XENNS-UP-cover-photo-1200x675-cropped.png"),
    "xenns tea 2": ("www.audio46.com", "https://www.audio46.com/products/xenns-mangird-tea2-universal-in-ear-monitor", "Xenns Mangird Tea2 Universal In-Ear Monitors",
        "https://cdn.shopify.com/s/files/1/0065/4432/6771/products/TEA2-1-1000.png"),
    "xenns tea": ("www.audio46.com", "https://www.audio46.com/products/mangird-tea-universal-in-ear-monitor", "Xenns Mangird Tea Universal In-Ear Monitors",
        "https://cdn.shopify.com/s/files/1/0065/4432/6771/products/Mangied-TEA-1.jpg"),
    "xenns mangird tea": ("www.audio46.com", "https://www.audio46.com/products/mangird-tea-universal-in-ear-monitor", "Xenns Mangird Tea Universal In-Ear Monitors",
        "https://cdn.shopify.com/s/files/1/0065/4432/6771/products/Mangied-TEA-1.jpg"),
    "nicehck nx8ti": ("shop.musicteck.com", "https://shop.musicteck.com/products/nx8ti-limited-edition", "NICEHCK NX8Ti Limited Edition",
        "https://cdn.shopify.com/s/files/1/0888/2348/files/1_1_d1153176-bf9f-4086-a97c-8036fcbed5ee.jpg"),
    "trn v30": ("linsoul.com (archived)", "https://web.archive.org/web/20191117133110/https://linsoul.com/products/trn-v30", "TRN V30",
        "http://cdn.shopify.com/s/files/1/0040/7201/3924/products/TRN-V30_1.jpg"),
    "cca ca10": ("linsoul.com (archived)", "https://web.archive.org/web/20250717031308/https://linsoul.com/products/cca-ca10", "CCA CA10",
        "http://www.linsoul.com/cdn/shop/products/2_717e6d18-0ffb-44f5-9737-c6789de95586.jpg"),
    "cca trio": ("linsoul.com (archived)", "https://web.archive.org/web/20250326052713/https://linsoul.com/products/cca-trio", "CCA Trio | 3*8mm Dynamic Driver In-Ear Monitor",
        "http://www.linsoul.com/cdn/shop/files/97247b9cabd72c62089afd32fffca6e0_8543b95a-4076-4d0c-9edd-94eb85a5e98e.jpg"),
    "kz as06": ("linsoul.com (archived)", "https://web.archive.org/web/20250423145235/https://linsoul.com/products/kz-as06", "KZ AS06",
        "http://www.linsoul.com/cdn/shop/products/14.jpg"),
    "kz ba10": ("shenzhenaudio.com (archived)", "https://web.archive.org/web/20211121014322/https://shenzhenaudio.com/products/kz-ba10-5ba-in-ear-earphone-metal-earphone-with-0-75mm-2-pins-detachable-cable", "KZ BA10 5BA In-Ear Earphone Metal Earphone with 0.75mm 2 Pins Detachable Cable",
        "http://cdn.shopify.com/s/files/1/0013/3896/6076/products/kz-ba10-5ba-in-ear-earphone-metal-earphone-with-075mm-2-pins-detachable-cable-780160.jpg"),
    "kz ate": ("shenzhenaudio.com (archived)", "https://web.archive.org/web/20220122113740/https://shenzhenaudio.com/products/kz-ate-dynamic-driver-hifi-sport-headphones-for-running-with-microphone-in-ear-earphone", "KZ ATE ATR HD9 Dynamic Driver HiFi Sport Headphones For Running With Microphone In Ear Earphone",
        "http://cdn.shopify.com/s/files/1/0013/3896/6076/products/kz-ate-atr-hd9-dynamic-driver-hifi-sport-headphones-for-running-with-microphone-in-ear-earphone-558386.jpg"),
    "blon x hbb z300": ("linsoul.com (archived)", "https://web.archive.org/web/20250713014430/https://linsoul.com/products/blon-x-hbb-z300", "BLON X HBB Z300 10mm Silicone Diaphragm In Ear Monitor",
        "http://www.linsoul.com/cdn/shop/products/IMG_5276_0faf169b-eac1-4084-b932-141f583916c5.jpg"),
    "blon z300": ("linsoul.com (archived)", "https://web.archive.org/web/20250713014430/https://linsoul.com/products/blon-x-hbb-z300", "BLON X HBB Z300 10mm Silicone Diaphragm In Ear Monitor",
        "http://www.linsoul.com/cdn/shop/products/IMG_5276_0faf169b-eac1-4084-b932-141f583916c5.jpg"),
    "kiwi ears etude": ("linsoul.com", "https://linsoul.com/products/kiwi-ears-etude", "Kiwi Ears Étude",
        "https://cdn.shopify.com/s/files/1/0040/7201/3924/files/KiwiEarsEtude_9.jpg"),
    "nf acous ne4": ("linsoul.com (archived)", "https://web.archive.org/web/20250518011515/https://linsoul.com/products/nf-audio-ne4", "Linsoul Audio-NF AUDIO NE4 4BA Replaceable Faceplate In-Ear Earphone",
        "http://www.linsoul.com/cdn/shop/products/NFAUDIONE401.jpg"),
    "nf acous na1": ("linsoul.com (archived)", "https://web.archive.org/web/20250423061050/https://linsoul.com/products/nfaudio-na1", "LINSOUL NFAUDIO NA1",
        "http://www.linsoul.com/cdn/shop/files/4_2f7f109a-ea16-4ef4-84cc-2921a5691db5.jpg"),
    "nicehck f1": ("linsoul.com (archived)", "https://web.archive.org/web/20250623073143/https://linsoul.com/products/nicehck-f1", "NiceHCK F1 Excellent 14.2mm Planar Driver In-Ear Earphone",
        "http://www.linsoul.com/cdn/shop/products/2_d354b808-3454-4dfb-9c9a-39f3292464f4.jpg"),
    "nicehck m5": ("linsoul.com (archived)", "https://web.archive.org/web/20250322125054/https://linsoul.com/products/nicehck-m5", "NiceHCK M5 M5 4BA+1DD Drivers Hybrid IEMs",
        "http://www.linsoul.com/cdn/shop/products/NiceHCKM51-1000.jpg"),
    "epz q1": ("linsoul.com (archived)", "https://web.archive.org/web/20250326043239/https://linsoul.com/products/epz-q1", "EPZ Q1",
        "http://www.linsoul.com/cdn/shop/products/7_8707e876-8c9b-4f99-9b1d-7ef11d201263.jpg"),
    "nicehck db1": ("www.nicehck.com (archived)", "https://web.archive.org/web/20240613033112/https://www.nicehck.com/products/nicehck-db1-hifi-music-in-ear-earphone-iem-10mm-dynamic-unit-running-dj-sport-audiophile-earbud-studio-earplug-2pin-detachable", "NiceHCK DB1 HIFI Music In Ear Earphone IEM 10mm Dynamic Unit Running D",
        "https://nicehck.com/cdn/shop/files/Haf28f02fc291427ba0b45b1a6b900775e.webp"),
    "nicehck traceless": ("www.nicehck.com (archived)", "https://web.archive.org/web/20240613035837/https://www.nicehck.com/products/nicehck-traceless-headphones", "NiceHCK Yuandao Traceless Hi-Fi Wired Earphones 15.4mm Dynamic Driver",
        "http://nicehck.com/cdn/shop/files/3.5.jpg"),
}


def archived_page(url):
    """(title, image URLs, archived page URL) of the latest archived copy of a product page, cached."""
    cache = RAW / "pages2" / ("wb_" + re.sub(r"[^a-z0-9]+", "_", url.lower())[-120:] + ".json")
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    html, page = snapshot_html(url)
    t = re.search(r'property="og:title"\s+content="([^"]+)"', html) or re.search(r"<title>([^<]+)</title>", html)
    imgs = re.findall(r'property="og:image"\s+content="([^"]+)"', html) +         re.findall(r'content="([^"]+)"\s+property="og:image"', html)
    imgs = list(dict.fromkeys("https:" + i if i.startswith("//") else i for i in imgs))[:4]
    out = [t.group(1).strip() if t else "", imgs, page]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-wayback", action="store_true")
    ap.add_argument("--dry", action="store_true", help="only print the matches, fetch no images")
    args = ap.parse_args()
    groups = json.loads(INPUT.read_text(encoding="utf-8"))
    found = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    tried_file = RAW / "tried.json"
    tried = json.loads(tried_file.read_text(encoding="utf-8")) if tried_file.exists() else {}
    rejected_file = RAW / "rejected.txt"  # product URLs checked by eye as the wrong photo
    rejected = set(rejected_file.read_text(encoding="utf-8").split()) if rejected_file.exists() else set()
    REJECTED.update(rejected)
    saved = {v["url"]: v["src"] for v in found.values()}  # product page -> photo already saved
    wb_done = set(tried.get("__wayback__", []))

    products = []
    for rank, d in enumerate([d for d in BRAND_SHOP] + [d for d in DOMAINS if d not in BRAND_SHOP]
                             + [d for d, b in EXTRA if not b]):
        src = RAW / "stores" / f"{d}.json" if d in dict(EXTRA) else ROOT / "data" / "raw" / "stores" / f"{d}.json"
        items = feed(d) if d in dict(EXTRA) else json.loads(src.read_text(encoding="utf-8"))
        for p in items:
            if p["images"] and p["url"] not in rejected \
                    and not re.search(r"open box|b-stock|refurb|bundle|combo|\+ ", p["title"], re.I):
                products.append({**p, "store": d, "rank": rank, "tok": tokens(p["title"])})

    # core models: several base names share one core ("RUMBA Stock", "RUMBA Clear" -> "RUMBA")
    cores = {}
    for g, models in groups.items():
        for name, ids in models.items():
            c = core(name)
            if c:
                cores.setdefault((g, c.lower()), []).extend(ids)
            else:
                print(f"skip (unclear name): {name}")

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    shop_handles = {}
    for (g, c), ids in sorted(cores.items()):
        if all(i in found for i in ids):
            continue
        brands, model = split(g, c)
        if c not in MANUAL and (not model or (len(model) == 1 and len(model[0]) < 3 and not model[0].isdigit())):
            tried[c] = "model name too short"
            continue
        if c in MANUAL and not args.dry:
            store, url, title, photo = MANUAL[c]
            img = pick([photo], archived=True)  # live photo first, archived copy if it is gone
            if img:
                entry = (img, store, url, title)
            result = f"manual {store}: {title}" if img else "manual photo failed"
            print(f"{c} [{len(ids)}]: {result}", flush=True)
            if entry:
                img, store, url, title = entry
                if url in saved:
                    src = saved[url]
                else:
                    slug = slug_for(c)
                    dest = IMG_DIR / f"{slug}.webp"
                    img.save(dest, "WEBP", quality=70, method=6)
                    clean(dest)
                    src = saved[url] = f"img/iem/{slug}.webp"
                for i in ids:
                    found[i] = {"src": src, "store": store, "url": url, "title": title}
                OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            tried[c] = result
            continue
        hits = [p for p in products if title_match(brands, model, p["tok"], BRAND_SHOP.get(p["store"]) == g)]
        result, entry = "no match", None
        if hits:
            best = min(hits, key=lambda p: (p["rank"], len(p["tok"])))
            same = {p["title"].lower() for p in hits if p["store"] == best["store"]}
            if len(same) > 3:
                result = f"ambiguous ({len(same)} titles on {best['store']})"
            elif args.dry:
                result = f"[{best['store']}] {best['title']}"
            else:
                for p in sorted(hits, key=lambda p: (p["rank"], len(p["tok"])))[:3]:
                    img = pick(p["images"])
                    if img:
                        entry = (img, p["store"], p["url"], p["title"])
                        break
                result = f"{best['store']}: {best['title']}" if entry else "no plain photo"
        if not entry and not args.dry and c.lower() in KNOWN_PAGES:
            title, imgs, page = archived_page(KNOWN_PAGES[c.lower()])
            if "penonaudio.com" in KNOWN_PAGES[c.lower()]:
                imgs = penon_archived_images(imgs)
            img = pick(imgs, archived=True) if imgs else None
            if img:
                entry = (img, KNOWN_PAGES[c.lower()].split("/")[0] + " (archived)", page, title)
                result = f"{entry[1]}: {title}"
        if not entry and not args.dry and not hits:
            entry = sitemap_stage(g, c, brands, model, rejected)
            if entry:
                result = f"{entry[1]}: {entry[3]}"
        if not entry and not args.no_wayback and not args.dry and c not in wb_done:
            wb_done.add(c)
            tried["__wayback__"] = sorted(wb_done)
            for shop in WAYBACK_SHOPS:
                if shop not in shop_handles:
                    shop_handles[shop] = [(h, tokens(h)) for h in wb_handles(shop)
                                          if not re.search(r"cable|tips|case|bundle|combo|deposit|reservation", h)]
                own = BRAND_SHOP.get(shop) == g
                cands = [h for h, ht in shop_handles[shop] if f"https://{shop}/products/{h}" not in rejected
                         and title_match(brands, model, ht, own)]
                if not cands:
                    continue
                handle = min(cands, key=len)
                imgs, page, title = wb_product(shop, handle)
                if not imgs or not title_match(brands, model, tokens(title), own):
                    continue
                img = pick(imgs, archived=True)
                if img:
                    entry = (img, f"{shop} (archived)", page, title)
                    result = f"{shop} (archived): {title}"
                    break
            if not entry:
                entry = penon_stage(g, brands, model, rejected)
                if entry:
                    result = f"{entry[1]}: {entry[3]}"
        if entry:
            img, store, url, title = entry
            if url in saved:   # same product as another name variant ("NF Audio NA2+" / "NF ACOUS NA2+")
                src = saved[url]
            else:
                slug = slug_for(c)
                dest = IMG_DIR / f"{slug}.webp"
                img.save(dest, "WEBP", quality=70, method=6)
                clean(dest)
                src = saved[url] = f"img/iem/{slug}.webp"
            for i in ids:
                found[i] = {"src": src, "store": store, "url": url, "title": title}
        tried[c] = result
        print(f"{c} [{len(ids)}]: {result}", flush=True)
        if not args.dry:
            OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            tried_file.write_text(json.dumps(tried, indent=0, ensure_ascii=False), encoding="utf-8")
    total = sum(len(v) for m in groups.values() for v in m.values())
    print(f"done: {len(found)} of {total} ids, {len({v['src'] for v in found.values()})} photos")


if __name__ == "__main__":
    main()
