"""Photos for group-b Chi-fi IEMs that still have none (Simgot, Moondrop, Tanchjim, Hidizs, ...).

Input: a JSON {BRAND: {base model name: [IEM ids]}} (default: the group-b list passed with --input).

1. Each name is reduced to its model ("Simgot ET142 BLUE NOZZLE SANCAI WIDE" -> brand SIMGOT,
   model "et142"): tip, nozzle, filter, mesh, unit and plug suffixes describe Jay's unit, not the
   model. Version words ("Pro", "2", "II", "SE", "Ultra", "DSP"...) are kept and must match exactly.
2. If another catalog entry of the same model already has a photo (images.json / images_archive.json),
   that photo is reused.
3. Otherwise product titles from shop feeds (the cached ones in data/raw/stores plus extra brand and
   retailer Shopify feeds cached in data/raw/brand_b/) are matched strictly: the model's tokens must
   appear contiguously, right after the brand / collab words, and the next word must not change the
   model (build_images.allowed_next). Brand shops first.
4. Pages of non-Shopify brand sites listed in PAGES give their og:image.
The first plain-background photo is saved as a 200 px WebP and its background removed.

Output: app/public/data/images_brand_b.json (IEM id -> {src, store, url, title}).
Polite: ~1 request/s per host; resumable (feeds and downloads are cached).

Usage: python -I scripts/brand_images_b.py --input <missing_group_b.json>
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
RAW = ROOT / "data" / "raw" / "brand_b"
CATALOG = ROOT / "app" / "public" / "data" / "iems.json"
EXISTING = [ROOT / "app" / "public" / "data" / "images.json", ROOT / "app" / "public" / "data" / "images_archive.json"]
OUT = ROOT / "app" / "public" / "data" / "images_brand_b.json"
IMG_DIR = ROOT / "app" / "public" / "img" / "iem"
SIZE = 200
DELAY = 1.1
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# extra Shopify feeds (brand shops first, then retailers not in stores.py)
EXTRA_SHOPS = ["hidizs.net", "bqeyz.com", "elysianacousticlabs.com", "afulaudio.com",
               "www.zeppelinandco.com", "www.null-audio.com", "www.headamp.com", "hangout.audio"]
# Shopify shops whose search API is asked for each still-unmatched model (finds products hidden from products.json)
SEARCH_SHOPS = ["hifigo.com", "linsoul.com", "shenzhenaudio.com", "hangout.audio", "apos.audio", "keephifi.com",
                "www.kineraaudio.com", "hidizs.net"]
BRAND_SHOP = {  # shop -> brand key (brand words may be missing from its titles)
    "hidizs.net": "HIDIZS", "bqeyz.com": "BQEYZ", "elysianacousticlabs.com": "ELYSIAN", "afulaudio.com": "AFUL",
    "letshuoer.net": "LETSHUOER", "tangzu.net": "TANGZU", "www.thieaudio.com": "THIEAUDIO",
    "www.kineraaudio.com": "KINERA", "fatfreq.com": "FATFREQ",
}

# brand key -> words that name the brand / sub-brand / collab (any one must appear before the model)
BRANDS = {
    "SIMGOT": ["simgot"], "TANGZU": ["tangzu"], "HIDIZS": ["hidizs"], "MOONDROP": ["moondrop"],
    "MYER": ["myer", "sliivo", "cklvx"], "TANCHJIM": ["tanchjim"], "7HZ": ["7hz", "salnotes"],
    "THIEAUDIO": ["thieaudio"], "DUNU": ["dunu"], "LETSHUOER": ["letshuoer"], "SHUOER": ["letshuoer"],
    "KINERA": ["kinera", "celest", "qoa"], "TINHIFI": ["tinhifi"], "TIN": ["tinhifi"], "KEFINE": ["kefine"],
    "ELYSIAN": ["elysian"], "AFUL": ["aful"], "TFZ": ["tfz", "supertfz"], "BGVP": ["bgvp"], "CVJ": ["cvj"],
    "FATFREQ": ["fatfreq"], "INTIME": ["intime"], "SIVGA": ["sivga"], "TRUTHEAR": ["truthear"],
    "LZ": ["lz"], "BQEYZ": ["bqeyz"], "CRINEAR": ["crinear"],
}
# words allowed between the brand and the model ("Simgot Audio", "x Crinacle", "Elysian Acoustic Labs")
BRIDGE = {"audio", "acoustics", "acoustic", "labs", "hi", "fi", "hifi", "x", "crinacle", "hbb", "celest",
          "sliivo", "cklvx", "myer", "salnotes", "new", "the", "official", "and", "elise", "angelears", "ddhifi", "dd",
          "letshuoer", "aoshida", "dn", "gizaudio", "qoa"}

# Jay's unit / setup descriptions, not the model (applied to the lower-cased name after the brand)
VARIANT = [
    r"\b\d+(\.\d+)? ?mm\b", r"\b\d+ ?ohms? adapter\b", r"\b\d+hms\b", r"\b2nd unit\b", r"\bunit \d\b", r"\bog\b",
    r"(\+ ?)?(\b\d )?\btanya filters?\b", r"\b\d+ mesh( filter)?\b", r"\bmesh\b", r"\bmod( foam)?\b", r"\bfoamax\b",
    r"\b(new |big )?(black|red|blue|gold|silver|white|pink|brass|green|stock)[ -]nozzles?\b",
    r"\b(black|green|pink) ring( clear)?\b",
    r"\b(azla|sedna|divinus|softears|sonic|sancai|ultra ?clear|ultraclear|tri clarion|red clarion|clarion)"
    r"( (sedna|origin|clear|regular|reg|wide|flange|noble|ultraclear))*\b",
    r"\bstock( (silicone|foam|white|black|clear|wide|balanced|anemone|bass|vocal))*\b", r"\bsilicone\b", r"\bfoam\b",
    r"\b(balance|bass) switch\b", r"\b(on|off)-(on|off)\b",
]
# whole-name overrides: name -> (brand key, model) ; model None = skip (too ambiguous / unknown product)
OVERRIDE = {
    "Truthear Crinacle x Red": ("TRUTHEAR", "zero red"),
    "Truthear Crinacle x Red 10 ohm adapter": ("TRUTHEAR", "zero red"),
    "Truthear Crinacle x Red 310 ohm adapter": ("TRUTHEAR", "zero red"),
    "Truthear Crinacle x Red 90 ohm adapter": ("TRUTHEAR", "zero red"),
    "Truthear x Crinacle Zero": ("TRUTHEAR", "zero"),
    "Truthear Blue 2": ("TRUTHEAR", "zero blue 2"),
    "AFUL Performer 5+2": ("AFUL", "performer 7"),  # same IEM: "AFUL Performer 5+2 / Performer 7" (brand shop title)
    "AFUL Acoustics Performer 5+2": ("AFUL", "performer 7"),
    "Moondrop Blessing 2:Dusk": ("MOONDROP", "blessing 2 dusk"),
    "Moondrop x Crinacle Blessing2 Dusk": ("MOONDROP", "blessing 2 dusk"),
    "MYER CKLVX": ("MYER", None),
    "Tangzu Wan’er S.G II Bass Version": ("TANGZU", None),
    "TANGZU Wan’er 2 BASS Sancai Wide": ("TANGZU", None),
    "TANGZU Wan’er 2 BASS Sonic": ("TANGZU", None),
    "TANGZU Zetian Wu": ("TANGZU", "wu zetian"),
    "TANGZU x HBB Zetian Wu Heyday Edition": ("TANGZU", "wu zetian heyday"),
    "Tanchjim FOLA Bass": ("TANCHJIM", "fola"), "Tanchjim FOLA Treble": ("TANCHJIM", "fola"),
    "Tanchjim SODA Bass Stock": ("TANCHJIM", "soda"), "Tanchjim SODA Treble Stock": ("TANCHJIM", "soda"),
    "Tanchjim Fission - Black/shadow Gold nozzle": ("TANCHJIM", "fission"),
    "Tanchjim Fission - Rose gold Gold nozzle": ("TANCHJIM", "fission"),
    "Kinera  Celest x ELISE Dark Phoenix": ("KINERA", "dark phoenix"),
    "Kinera Celest Adonis New": ("KINERA", "adonis new"),  # QoA (Kinera sub-brand) Adonis New
    "TANGZU x HBB NV": ("TANGZU", "xuan nv"),  # sold as "Tangzu x HBB XuanNv"
    "TANGZU Wan’er 2": ("TANGZU", "waner sg 2"),  # sold as "Wan'er S.G II"
    "Moondrop LAN 2 POP": ("MOONDROP", "lan 2"), "Moondrop LAN 2 REF": ("MOONDROP", "lan 2"),  # two tunings, one shell
    "Kinera Celest Wyvern Black Remastered": ("KINERA", "wyvern black remaster"),
    "7Hz Timless II": ("7HZ", "timeless 2"),
    "Moondrop x DD ddHiFi Surface": ("MOONDROP", "surface"),
    "HIDIZS MK12 x DucBloke": ("HIDIZS", None),
    "Hidizs MK12 TURRIS RED CLARION": ("HIDIZS", "mk12 turris"),
    "Hidizs MP145 Golden Titanium Edition": ("HIDIZS", None),
    "Hidizs MP143 Golden Titanium": ("HIDIZS", None),
    "HIDIZS mp143 Gold": ("HIDIZS", None),
    "Simgot EA1000 RED MOD": ("SIMGOT", None), "Simgot EA1000 ZEUS MOD": ("SIMGOT", None),
    "Simgot EA500LM MOD": ("SIMGOT", None),
    "Letshuoer EJ07M Kinda Lava Resin": ("LETSHUOER", None),
    "Letshuoer EJ07M Kinda Lava Yellow Custom": ("LETSHUOER", None),
    "Letshuoer EJ07M Resin": ("LETSHUOER", None),
    "Shuoer S12 2024 Special Edition": ("SHUOER", "s12 2024"),
    "Shuoer Cadenza 12 2025 Edition": ("SHUOER", "cadenza 12 2025"),
    "Moondrop Chu OG": ("MOONDROP", "chu"),
    "MYER-AUDIO CKLVX SLIIVO SLT6": ("MYER", "slt6"),
    "TFZ x Angelears Athena": ("TFZ", "athena"),
    "BGVP Phantom SE Snake Edition": ("BGVP", "phantom se"),
    "DUNU DK3001BD Braindance 80hms": ("DUNU", "dk3001bd"),
    "DUNU DK3001BD Braindance": ("DUNU", "dk3001bd"),
    "Hidizs MP145 PRO Brass Stock Balanced": ("HIDIZS", "mp145 pro"),
    "MYER SLIIVO SL41 PRO DD Green Stock": ("MYER", "sl41 pro"),
    "MYER SLIIVO SL41 PRO UD/DU Green Stock": ("MYER", "sl41 pro"),
    "MYER SLIIVO SL41 PRO UU Green Stock": ("MYER", "sl41 pro"),
    "Letshuoer S12 ULTRA Clear": ("LETSHUOER", None),
    "CVJ MYTHERA BGVP CLEAR": ("CVJ", "mythera"),
    "HIDIZS ST2 Nebula": ("HIDIZS", "st2 pro nebula"),  # sold only as "ST2 PRO Nebula"
}
# colour editions of the same shell (photo of the model is fine); applied only at the end of a name
TRAILING_COLOUR = re.compile(r"(\s+(black|white|gold|silver|red|blue|green|grey|orange|candy|clear|pink|"
                             r"rose gold|bronze|black green|orange black|grey black|black wide|wide))+$")
KEEP_COLOUR = {"truthear zero red", "kinera celest wyvern black"}


def model_of(brand, name):
    """(brand key, model string) or (brand, None)."""
    if name in OVERRIDE:
        b, m = OVERRIDE[name]
        return b, (" ".join(tokens(m)) if m else None)
    s = name.lower().replace("’", "'").replace("'", "")
    s = re.sub(r"\btin ?hi-?fi\b", "tinhifi", s)
    s = re.sub(r"\bmyer-audio\b", "myer audio", s)
    s = re.sub(r"\blz hi-fi audio\b", "lz", s)
    s = s.replace(" - ", " ")
    for rx in VARIANT:
        s = re.sub(rx, " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s not in KEEP_COLOUR:
        s = TRAILING_COLOUR.sub("", s)
    t = tokens(s)
    alias = set(BRANDS[brand]) | {"letshuoer"}
    while t and (t[0] in alias or t[0] in BRIDGE):
        t = t[1:]
    # trailing "edition" left from "Golden Titanium Edition" etc. would be a different product: keep strict
    return brand, " ".join(t) or None


def norm_title(title):
    s = title.lower().replace("’", "'").replace("'", "")
    s = re.sub(r"\btin ?hi-?fi\b", "tinhifi", s)
    s = re.sub(r"\bblessing ?2 ?: ?dusk\b", "blessing 2 dusk", s)
    s = re.sub(r"\bzero ?: ?red\b", "zero red", s)
    s = re.sub(r"\bzetian wu\b", "wu zetian", s)
    s = re.sub(r"\btimless\b", "timeless", s)
    s = re.sub(r"\bii\b", "2", s)
    return tokens(s)


def norm_model(m):
    return norm_title(m)


# nicknames retailers put right after a model name, checked by hand ("EA1000 Fermat"): model key -> words
NICK: dict[str, set] = {
    "SIMGOT ea 1000": {"fermat"}, "HIDIZS mp 143": {"salt"}, "HIDIZS mk 12 turris": set(),
    "TANCHJIM fola": {"dmt"}, "TFZ live x": {"tesla"}, "TINHIFI c 3": {"lcp"}, "TINHIFI t 1 plus": {"beryllium"},
    "TANGZU wu zetian heyday": {"edition"}, "AFUL performer 5 plus 2": {"performer"}, "AFUL performer 7": {"5"},
    "LETSHUOER s 12 2024": {"8", "edition"}, "MOONDROP block": {"true"},
    "HIDIZS st 2 pro": {"nebula"}, "HIDIZS my lin": {"special"},
}
NEXT_OK = {"universal", "tribrid", "discontinued", "iem", "earphone", "earphones", "flagship"}


def accessory(title):
    """build_images.ACCESSORY, but "In-ear Headphone" (shenzhenaudio's word for an IEM) is not an accessory."""
    if re.search(r"\bin[- ]?ear\b|\biems?\b", title, re.I):
        title = re.sub(r"\b(wired )?headphones?\b", " ", title, flags=re.I)
    return ACCESSORY.search(title)
SPEC_AFTER_DIGIT = {"th", "driver", "drivers", "dynamic", "balanced", "ba", "dd", "cnt", "knowles", "planar", "bas"}


def spans(tt, joined):
    """(start, end) of contiguous token runs of tt whose concatenation equals joined ("kanas pro" == "kanaspro")."""
    for i in range(len(tt)):
        s = ""
        for j in range(i, len(tt)):
            s += tt[j]
            if s == joined:
                yield i, j + 1
            if len(s) >= len(joined) or not joined.startswith(s):
                break


def title_matches(brand, model_t, tt, own_shop, loose=False):
    """Model tokens (spacing-insensitive) right after brand/collab words; the next word must not change the model.
    loose=True: ignore the next-word rule (dry-run diagnostics only)."""
    alias = set(BRANDS[brand])
    nick = NICK.get(f"{brand} {' '.join(model_t)}", set())
    if not (own_shop or any(a in tt for a in alias)):
        return False
    for i, e in spans(tt, "".join(model_t)):
        prev_ok = i == 0 or tt[i - 1] in alias or tt[i - 1] in BRIDGE
        nxt = tt[e] if e < len(tt) else None
        after = tt[e + 1] if e + 1 < len(tt) else None
        nxt_ok = (allowed_next(nxt) or nxt in nick or nxt in NEXT_OK
                  # "DM9 9 Driver", "MD4 4 Balanced", "A2 Pro 1 Dynamic", "Fission 5th-Generation" (not "Aria 2 Dynamic")
                  or (nxt is not None and nxt.isdigit() and after in SPEC_AFTER_DIGIT
                      and (nxt == model_t[-1] or (nxt == "1" and after in ("dynamic", "cnt"))
                           or (after == "th" and int(nxt) >= 4))))
        if prev_ok and (loose or nxt_ok):
            return True
    return False


# ---------------------------------------------------------------- network
_last = {}


def get(url, tries=3):
    host = url.split("/")[2]
    for k in range(tries):
        wait = DELAY - (time.time() - _last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 403, 401, 410):
                return None
            time.sleep((20 if e.code == 429 else 5) * (k + 1))  # 429: Shopify rate limit, back off longer
        except Exception:
            time.sleep(3 * (k + 1))
    return None


def shop_feed(shop):
    cache = RAW / "stores" / f"{shop}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    products, page = [], 1
    while page < 40:
        body = get(f"https://{shop}/products.json?limit=250&page={page}")
        try:
            batch = json.loads(body)["products"] if body else []
        except Exception:
            batch = []
        if not batch:
            break
        for p in batch:
            products.append({"title": p["title"], "url": f"https://{shop}/products/{p['handle']}",
                             "images": [i["src"] for i in p.get("images", [])[:3]]})
        page += 1
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(products, ensure_ascii=False), encoding="utf-8")
    print(f"feed {shop}: {len(products)} products", flush=True)
    return products


def fetch_image(url):
    cache = RAW / "img_cache.json"
    sized = url + ("&" if "?" in url else "?") + f"width={SIZE * 2}" if "cdn.shopify" in url or "/cdn/shop/" in url else url
    data = get(sized) or get(f"http://web.archive.org/web/0id_/{url}")  # archived copy if the CDN dropped it
    if not data:
        return None
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
        return img
    except Exception:
        return None


def pick_photo(urls):
    """First plain-background (or transparent) photo among urls, as a 200 px image; None if none is plain."""
    for u in urls[:3]:
        if u.startswith("//"):
            u = "https:" + u
        img = fetch_image(u)
        if img is None:
            continue
        transparent = "A" in img.getbands() or "transparency" in img.info
        if transparent and img.mode != "RGBA":
            img = img.convert("RGBA")
        if transparent:
            a = np.asarray(img)[..., 3]
            if a.min() > 250:
                transparent = False
        img = img.convert("RGBA" if transparent else "RGB")
        img.thumbnail((SIZE, SIZE))
        if transparent:
            # flatten onto white so clean() can treat it like any plain background
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            return bg
        if plainness(np.asarray(img)) >= 0.85:
            return img
    return None


def og_image(url):
    html = get(url)
    if not html:
        return None, None
    m = (re.search(rb'property=["\']og:image["\']\s+content=["\']([^"\']+)', html)
         or re.search(rb'content=["\']([^"\']+)["\']\s+property=["\']og:image', html))
    t = re.search(rb"<title>(.*?)</title>", html, re.S)
    title = t.group(1).decode("utf-8", "replace").strip() if t else url
    return (m.group(1).decode() if m else None), title


# products whose chosen photo was checked by eye and is not a clean shot of the IEM (box, logo collage...)
REJECT_URLS = {"https://hifigo.com/products/tanchjim-fola", "https://fatfreq.com/products/quantum"}

# Non-Shopify brand pages checked by hand to be the exact model: model key -> page URL
PAGES: dict[str, str] = {}


def save_photo(key, img, mine):
    slug = re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")
    dest = IMG_DIR / f"{slug}.webp"
    if dest.exists() and dest.name not in mine:
        slug += "-b"
        dest = IMG_DIR / f"{slug}.webp"
    img.save(dest, "WEBP", quality=70, method=6)
    clean(dest)
    mine.add(dest.name)
    (RAW / "my_files.json").write_text(json.dumps(sorted(mine)), encoding="utf-8")
    return f"img/iem/{slug}.webp"


# Non-Shopify brand sites: product listing pages and the link pattern whose slug names the model
INDEX = {
    "MOONDROP": (["https://moondroplab.com/en/products"], r"moondroplab\.com/en/products/([a-z0-9-]+)", "https://moondroplab.com/en/products/{}"),
    "TANCHJIM": ([f"https://tanchjim.com/product-category/earphones/iem/{p}" for p in ("", "page/2/", "page/3/")]
                 + ["https://tanchjim.com/product-category/earphones/"],
                 r"tanchjim\.com/products/earphones/((?:iem|tws)/[a-z0-9-]+)/", "https://tanchjim.com/products/earphones/{}/"),
    "DUNU": ([f"https://www.dunu-topsound.com/category/all-products{p}" for p in ("", "?page=2", "?page=3")],
             r"dunu-topsound\.com/product-page/([a-z0-9-]+)", "https://www.dunu-topsound.com/product-page/{}"),
    "TRUTHEAR": (["https://truthear.com/", "https://truthear.com/iems"], r"/products/([a-z0-9-]+)", "https://truthear.com/products/{}"),
}


def index_pass(models, found, log, mine):
    for brand, (pages, rx, tmpl) in INDEX.items():
        todo = [(m, info) for (b, m), info in sorted(models.items()) if b == brand and not any(i in found for i in info["ids"])]
        if not todo:
            continue
        cache = RAW / "index" / f"{brand}.json"
        if cache.exists():
            slugs = json.loads(cache.read_text(encoding="utf-8"))
        else:
            slugs = set()
            for u in pages:
                html = get(u) or b""
                slugs |= set(re.findall(rx, html.decode("utf-8", "replace")))
            slugs = sorted(slugs)
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(slugs), encoding="utf-8")
        st = [(sl, norm_title(sl.split("/")[-1].replace("-", " "))) for sl in slugs
              if not re.search(r"preorder|pre-order|launch|cable|tips|case|bundle|deposit", sl)]
        for model, info in todo:
            key = f"{brand} {model}"
            mt = norm_model(model)
            cands = [sl for sl, t in st if title_matches(brand, mt, t, True)]
            if not cands or len(cands) > 3:
                continue
            url = tmpl.format(min(cands, key=len))
            if url in REJECT_URLS:
                continue
            src, title = og_image(url)
            img = pick_photo([src]) if src else None
            if img is None:
                log[key] = f"brand page has no plain photo: {url}"
                print(ascii(f"{key}: {log[key]}"), flush=True)
                continue
            path = save_photo(key, img, mine)
            for i in info["ids"]:
                found[i] = {"src": path, "store": url.split("/")[2], "url": url, "title": re.sub(r"\s+", " ", title)[:120]}
            log[key] = f"brand page {url}"
            OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            print(ascii(f"{key}: {log[key]}"), flush=True)


EXCLUDE_TITLE = (r"open box|b-stock|refurb|bundle|\+\s*[a-z]|combo|deposit|pre-?order|reservation|unboxed|"
                 r"price difference")


# photos picked by hand from non-shop pages (wide banners are cropped to the IEM): model key -> (image, page, title)
MANUAL = {
    "SIMGOT en 1000": ("http://www.simgot.com/upload/product/22/20220718154909713.jpg",
                       "http://www.simgot.com/en/products/detail/22.html", "SIMGOT EN1000 (simgot.com)"),
    "SIMGOT em 6 l phoenix": ("http://www.simgot.com/upload/product/30/20230719165540499.jpg",
                              "http://www.simgot.com/en/products/detail/30.html", "SIMGOT EM6L (simgot.com)"),
    "SIMGOT en 700 pro": ("http://www.simgot.com/upload/product/8/20170607150411280.jpg",
                          "http://www.simgot.com/en/products/detail/8.html", "SIMGOT EN700 PRO (simgot.com)"),
    # intime (O2aid) models on e-earphone.jp (Shopify; image None = use the product's own photos)
    "KINERA wyvern abyss": (None, "https://linsoul.com/products/kinera-celest-wyvern-abyss", "Celest Wyvern Black (Abyss)"),
    "BGVP phantom se": (None, "https://hifigo.com/products/bgvp-phantom-special-edition-1", "BGVP Phantom Special Edition"),
    "INTIME miyabi": (None, "https://www.e-earphone.jp/products/221369", "intime 雅 (MIYABI)"),
    "INTIME sho dd": (None, "https://www.e-earphone.jp/products/145871", "intime 翔 DD"),
    "INTIME sora": (None, "https://www.e-earphone.jp/products/121259", "intime 碧（SORA）"),
    "INTIME sora 2": (None, "https://www.e-earphone.jp/products/83228", "intime 碧（SORA）-2"),
    "INTIME sora light": (None, "https://www.e-earphone.jp/products/121261", "intime 碧（SORA）-Light"),
    "INTIME todoroki go": (None, "https://www.e-earphone.jp/products/83152", "intime 轟（GO）"),
    "INTIME yo": (None, "https://www.e-earphone.jp/products/198157", "intime 耀 (YO)"),
}


def crop_to_subject(img):
    """Crop a plain-background banner to the bounding box of what differs from its corner colour, padded square."""
    a = np.asarray(img.convert("RGB")).astype(int)
    bg = np.median(np.concatenate([a[:4, :4].reshape(-1, 3), a[-4:, -4:].reshape(-1, 3)]), axis=0)
    mask = np.abs(a - bg).sum(axis=2) > 40
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return img
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = int(max(x1 - x0, y1 - y0) * 1.08)
    sq = Image.new("RGB", (side, side), tuple(int(c) for c in bg))
    sq.paste(img.convert("RGB").crop((x0, y0, x1, y1)), ((side - (x1 - x0)) // 2, (side - (y1 - y0)) // 2))
    return sq


def manual_pass(models, found, log, mine):
    for (brand, model), info in sorted(models.items()):
        key = f"{brand} {model}"
        if key not in MANUAL or any(i in found for i in info["ids"]):
            continue
        src_url, page, title = MANUAL[key]
        if src_url is None:  # Shopify product: its first plain photo
            try:
                imgs = [i["src"] for i in json.loads(get(page + ".json"))["product"]["images"]]
            except Exception:
                imgs = []
            img = pick_photo(imgs)
            if img is not None:
                img = crop_to_subject(img)
                img.thumbnail((SIZE, SIZE))
        else:
            img = fetch_image(src_url)
            if img is not None:
                img = crop_to_subject(img)
                img.thumbnail((SIZE, SIZE))
        if img is None or plainness(np.asarray(img)) < 0.85:
            log[key] = "manual: not plain after crop"
            print(ascii(f"{key}: {log[key]}"), flush=True)
            continue
        src = save_photo(key, img, mine)
        for i in info["ids"]:
            found[i] = {"src": src, "store": page.split("/")[2], "url": page, "title": title}
        log[key] = f"manual {page}"
        OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(ascii(f"{key}: {log[key]}"), flush=True)


def search_pass(models, found, log, mine):
    """Shopify search API (search/suggest.json) of SEARCH_SHOPS for models no feed matched; same strict title match."""
    cache_f = RAW / "search_cache.json"
    cache = json.loads(cache_f.read_text(encoding="utf-8")) if cache_f.exists() else {}
    for (brand, model), info in sorted(models.items()):
        key = f"{brand} {model}"
        if any(i in found for i in info["ids"]):
            continue
        mt = norm_model(model)
        glued = re.sub(r"\b([a-z]+) (\d+)\b", r"\1\2", model)
        glued = re.sub(r"\b(\d+) ([a-z])\b", r"\1\2", glued)
        first = mt[0] if mt[0].isalpha() and len(mt[0]) >= 3 else glued.split()[0]
        word = BRANDS[brand][0]
        hits = []
        for shop in sorted(SEARCH_SHOPS, key=lambda s: BRAND_SHOP.get(s) != brand):
            own = BRAND_SHOP.get(shop) == brand
            if BRAND_SHOP.get(shop) and not own:
                continue
            for q in dict.fromkeys([f"{word} {glued}", f"{word} {first}"] + ([glued] if own else [])):
                ck = f"{shop}|{q}"
                if ck not in cache:
                    body = get(f"https://{shop}/search/suggest.json?q={urllib.parse.quote(q)}"
                               "&resources%5Btype%5D=product&resources%5Blimit%5D=10")
                    try:
                        res = json.loads(body)["resources"]["results"]["products"] if body else []
                    except Exception:
                        res = []
                    cache[ck] = [{"title": r["title"], "url": f"https://{shop}/products/{r['handle']}",
                                  "image": r.get("image") or (r.get("featured_image") or {}).get("url")} for r in res]
                    cache_f.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
                for r in cache[ck]:
                    if (r["image"] and r["url"] not in REJECT_URLS and not accessory(r["title"])
                            and not re.search(EXCLUDE_TITLE, r["title"], re.I)
                            and title_matches(brand, mt, norm_title(r["title"]), own)
                            and r["url"] not in [h["url"] for h in hits]):
                        hits.append({**r, "store": shop})
        if len({h["title"].lower() for h in hits}) > 4:
            log[key] = "search: too many different products " + " || ".join(h["title"] for h in hits[:5])
            print(ascii(f"{key}: {log[key]}"), flush=True)
            continue
        for h in hits[:4]:
            img = pick_photo([h["image"]])
            if img is None:
                body = get(h["url"] + ".js")
                try:
                    imgs = [u for u in json.loads(body)["images"]][1:3] if body else []
                except Exception:
                    imgs = []
                img = pick_photo(imgs) if imgs else None
            if img is None:
                continue
            src = save_photo(key, img, mine)
            for i in info["ids"]:
                found[i] = {"src": src, "store": h["store"], "url": h["url"], "title": h["title"]}
            log[key] = f"search {h['store']}: {h['title']}"
            OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            break
        else:
            if hits:
                log[key] = "search matched, no plain photo: " + hits[0]["url"]
        if key in log:
            print(ascii(f"{key}: {log[key]}"), flush=True)


def wayback_pass(models, found, log, mine, budget):
    """Archived product pages (Wayback Machine) of the shops, for models no live feed matched."""
    import wayback_images as wb  # noqa: E402  (its cached handle lists and snapshot helpers)
    tried_file = RAW / "wayback_tried.json"
    tried = json.loads(tried_file.read_text(encoding="utf-8")) if tried_file.exists() else {}
    shops = [f.stem for f in sorted((ROOT / "data" / "raw" / "wayback").glob("*.txt"))]
    order = {s: i for i, s in enumerate(DOMAINS)}
    shops.sort(key=lambda s: order.get(s, 99))
    handles = {s: [(h, t, "".join(t)) for h in wb.handles(s) for t in [norm_title(h.replace("-", " "))] if not wb.SKIP_HANDLE.search(h)
                   and not re.search(r"open-box|b-stock|refurb|unboxed|bundle|combo|-with-", h)] for s in shops}
    n = 0
    for (brand, model), info in sorted(models.items()):
        key = f"{brand} {model}"
        if any(i in found for i in info["ids"]) or key in tried:
            continue
        if n >= budget:
            break
        n += 1
        mt = norm_model(model)
        result = "no archived page"
        for shop in sorted(shops, key=lambda s: BRAND_SHOP.get(s) != brand):
            j = "".join(mt)
            cands = [h for h, ht, hj in handles[shop] if j in hj and title_matches(brand, mt, ht, BRAND_SHOP.get(shop) == brand)]
            if not cands or len(cands) > 3:
                continue
            handle = min(cands, key=len)
            imgs, page, title = wb.product_images(shop, handle)
            if not imgs or accessory(title or "") or not title_matches(
                    brand, mt, norm_title(title or ""), BRAND_SHOP.get(shop) == brand):
                continue  # the archived title must pass the same strict match as the handle
            img = pick_photo(imgs)
            if img is None:
                continue
            src = save_photo(key, img, mine)
            for i in info["ids"]:
                found[i] = {"src": src, "store": f"{shop} (archived)", "url": page, "title": title}
            result = f"{shop}/{handle}: {title}"
            break
        tried[key] = result
        log[key] = "wayback " + result
        tried_file.write_text(json.dumps(tried, indent=0, ensure_ascii=False), encoding="utf-8")
        OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(ascii(f"{key}: wayback {result}"), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--dry", action="store_true", help="match only, download nothing")
    ap.add_argument("--wayback", type=int, default=0, help="also look up to N unmatched models in archived shop pages")
    ap.add_argument("--search", action="store_true", help="also ask SEARCH_SHOPS' Shopify search for unmatched models")
    args = ap.parse_args()
    groups = json.loads(Path(args.input).read_text(encoding="utf-8"))
    RAW.mkdir(parents=True, exist_ok=True)
    pages_file = RAW / "pages.json"
    PAGES.update(json.loads(pages_file.read_text(encoding="utf-8")) if pages_file.exists() else {})

    # models to find: (brand, model) -> list of ids
    models, skipped = {}, []
    for brand, names in groups.items():
        for name, ids in names.items():
            b, m = model_of(brand, name)
            if not m:
                skipped.append(name)
                continue
            b = "LETSHUOER" if b == "SHUOER" else ("TINHIFI" if b == "TIN" else b)
            models.setdefault((b, m), {"ids": [], "names": []})
            models[(b, m)]["ids"] += ids
            models[(b, m)]["names"].append(name)
    print(f"{sum(len(v) for v in groups.values())} names -> {len(models)} models ({len(skipped)} skipped as unknown variants)")

    # existing photos, by (brand, model) of their catalog names
    have = {}
    for f in EXISTING:
        have.update(json.loads(f.read_text(encoding="utf-8")))
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))["iems"]
    reuse = {}
    for it in cat:
        if it["id"] not in have:
            continue
        # full name, parenthesised variants included: "Zero (Red)" must not lend its photo to "Zero"
        nm = re.sub(r"[()]", " ", it["name"]).strip()
        first = nm.split()[0].upper().replace("-AUDIO", "")
        for brand, alias in BRANDS.items():
            if tokens(nm)[:1] and (tokens(nm)[0] in alias or first == brand or
                                   (brand == "TINHIFI" and re.match(r"tin ?hi-?fi", nm, re.I)) or
                                   (brand == "LETSHUOER" and re.match(r"(lets)?shuoer", nm, re.I))):
                b, m = model_of(brand, nm)
                if m:
                    e = have[it["id"]]
                    st = norm_title(Path(e["src"]).stem)
                    mt_ = norm_model(m)
                    # the photo's own file name must not name a different version ("...-zero-red" for "zero")
                    ok = any(e2 == len(st) or allowed_next(st[e2]) for _, e2 in spans(st, "".join(mt_)))
                    if ok:
                        reuse.setdefault((brand, tuple(mt_)), e)
                break

    products = []
    for rank, shop in enumerate(EXTRA_SHOPS[:4] + DOMAINS + EXTRA_SHOPS[4:]):
        cached = ROOT / "data" / "raw" / "stores" / f"{shop}.json"
        feed = json.loads(cached.read_text(encoding="utf-8")) if cached.exists() else shop_feed(shop)
        for p in feed:
            if p.get("images") and not accessory(p["title"]) and not re.search(
                    r"open box|b-stock|refurb|bundle|\+\s*[a-z]|combo|deposit|pre-?order|reservation|unboxed|price difference",
                    p["title"], re.I):
                products.append({**p, "store": shop, "rank": rank, "tok": norm_title(p["title"])})

    found = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for i in [i for i, e in found.items() if e["url"] in REJECT_URLS]:
        del found[i]
    mine_file = RAW / "my_files.json"
    mine = set(json.loads(mine_file.read_text(encoding="utf-8"))) if mine_file.exists() else set()
    log = {}
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    for (brand, model), info in sorted(models.items()):
        mt = norm_model(model)
        key = f"{brand} {model}"
        if all(i in found for i in info["ids"]):
            log[key] = "done earlier"
            continue
        if (brand, tuple(mt)) in reuse:
            e = reuse[(brand, tuple(mt))]
            for i in info["ids"]:
                found[i] = dict(e)
            log[key] = f"reuse {e['src']}"
            continue
        hits = [p for p in products if title_matches(brand, mt, p["tok"], BRAND_SHOP.get(p["store"]) == brand)]
        # brand shop of this brand first, then shop order, then the plainest title
        hits.sort(key=lambda p: (BRAND_SHOP.get(p["store"]) != brand, p["rank"], len(p["tok"])))
        cand = []
        for p in hits:
            if len({q["title"].lower() for q in hits if q["store"] == p["store"]}) > 3:
                continue  # too many different products contain this name in that shop
            if p["url"] not in REJECT_URLS:
                cand.append(p)
        if key in PAGES:
            cand.insert(0, {"store": PAGES[key].split("/")[2], "url": PAGES[key], "page": True})
        if not cand:
            log[key] = "no match"
            if args.dry:
                near = [p for p in products if title_matches(brand, mt, p["tok"], BRAND_SHOP.get(p["store"]) == brand, True)]
                if near:
                    log[key] += " | near: " + " || ".join(sorted({f"{p['store']}: {p['title']}" for p in near})[:6])
            continue
        if args.dry:
            log[key] = " || ".join(f"{p['store']}: {p.get('title', p['url'])}" for p in cand[:3])
            continue
        done = False
        for p in cand[:4]:
            if p.get("page"):
                src, title = og_image(p["url"])
                urls = [src] if src else []
                p = {**p, "title": title}
            else:
                urls = p["images"]
            img = pick_photo(urls)
            if img is None:
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")
            dest = IMG_DIR / f"{slug}.webp"
            if dest.exists() and dest.name not in mine:
                slug += "-b"
                dest = IMG_DIR / f"{slug}.webp"
            img.save(dest, "WEBP", quality=70, method=6)
            clean(dest)
            mine.add(dest.name)
            for i in info["ids"]:
                found[i] = {"src": f"img/iem/{slug}.webp", "store": p["store"], "url": p["url"], "title": p["title"]}
            log[key] = f"{p['store']}: {p['title']}"
            done = True
            break
        if not done:
            log[key] = "matched, but no plain photo: " + cand[0]["store"] + " " + cand[0].get("title", "")
        OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        mine_file.write_text(json.dumps(sorted(mine)), encoding="utf-8")
        print(ascii(f"{key}: {log[key]}"), flush=True)

    if not args.dry:
        index_pass(models, found, log, mine)
        manual_pass(models, found, log, mine)
        if args.search:
            search_pass(models, found, log, mine)
        mine_file.write_text(json.dumps(sorted(mine)), encoding="utf-8")
    if args.wayback and not args.dry:
        wayback_pass(models, found, log, mine, args.wayback)
        mine_file.write_text(json.dumps(sorted(mine)), encoding="utf-8")
    if not args.dry:
        OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (RAW / ("log_dry.json" if args.dry else "log.json")).write_text(json.dumps(log, indent=1, ensure_ascii=False), encoding="utf-8")
    total_ids = sum(len(v) for g in groups.values() for v in g.values())
    got = {i for i in found if any(i in v for g in groups.values() for v in g.values())}
    print(f"models: {sum(1 for v in log.values() if not v.startswith(('no match', 'matched,')))}/{len(models)} "
          f"(log entries); ids with photo: {len(got)}/{total_ids}")


if __name__ == "__main__":
    main()
