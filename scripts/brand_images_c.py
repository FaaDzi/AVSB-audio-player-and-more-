"""Photos for the long tail of IEMs still without one (group c: Sony, JVC, Samsung, Campfire,
64 Audio, Symphonium, Softears, Audiosense, EarAcoustic, Hisenior, Oriveti, Rose, ... ~250 brands).

What's different from build_images.py / wayback_images.py:
- variant names fall back to their base model ("Oriveti Purecaster Black Nozzle Stock" -> "Oriveti
  Purecaster", "64 AUDIO Volur m15" -> "64 AUDIO Volur"), never to a different model: the same strict
  next-word rule applies, so "Pro"/"II"/"2"/"SE"/"Ultra" still have to agree;
- the brand and model are matched separately ("Campfire Bonneville" finds "Campfire Audio Bonneville"),
  the model words contiguously, the brand words anywhere in the title (or the shop is the brand's own);
- extra brand shops and retailers not in stores.py (Shopify feeds, cached under data/raw/brand_c/);
- the Wayback Machine for product pages no shop lists any more (handle lists of data/raw/wayback/);
- a few hand-picked official product pages (og:image) for big brands without a Shopify feed.

Polite: ~1 request/second per host. Resumable: shop feeds and per-model results are cached.
Output: app/public/data/images_brand_c.json (IEM id -> {src, store, url, title}).

Usage: python -I scripts/brand_images_c.py [--input missing_group_c.json] [--no-wayback] [--max-wayback N]
       [--skip-live] [--live-from NAME]   (a live-shop miss is remembered as "s1: none" and not retried)
"""
import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
import numpy as np  # noqa: E402
from build_images import ACCESSORY, GENERIC, allowed_next, find, tokens  # noqa: E402
from clean_backgrounds import clean, plainness  # noqa: E402
from stores import DOMAINS  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "brand_c"
STORE_CACHE = ROOT / "data" / "raw" / "stores"
WAYBACK_CACHE = ROOT / "data" / "raw" / "wayback"
IMG_DIR = ROOT / "app" / "public" / "img" / "iem"
OUT = ROOT / "app" / "public" / "data" / "images_brand_c.json"
SIZE = 200
DELAY = 1.1
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# Shopify shops not in stores.py: domain -> brand first-token(s) when it is a brand's own shop (else None)
NEW_SHOPS = {
    "symphoniumaudio.com": ["symphonium"],
    "global.roseselsa.com": ["rose", "roseselsa"],
    "soundpeats.com": ["soundpeats", "soundpeat"],
    "effectaudio.com": ["effect"],
    "www.ikkoaudio.com": ["ikko"],
    "www.qcy.com": ["qcy"],
    "www.tipsyaudio.com": ["tipsy"],
    "plungeaudio.com": ["plunge"],
    "ruviest.com": ["ruviest"],
    "pulaaudio.com": ["pula"],
    "ditaaudio.com": ["dita"],
    "www.nobleaudio.com": ["noble"],
    "mezeaudio.com": ["meze"],
    "www.lypertek.com": ["lypertek"],
    "www.thinksound.com": ["thinksound"],
    "www.kotoriaudio.com": ["kotori"],
    "www.nothing.tech": ["nothing", "cmf"],
    "www.koss.com": ["koss"],
    "www.tozostore.com": ["tozo"],
    "www.zeppelinandco.com": None,
    "www.theaudiostore.in": None,
    "www.e-earphone.jp": None,
}
# brand shops already cached by build_images.py
OLD_BRAND_SHOPS = {
    "kiwiears.com": ["kiwi"], "letshuoer.net": ["letshuoer"], "tangzu.net": ["tangzu"], "ziigaat.com": ["ziigaat"],
    "www.thieaudio.com": ["thieaudio"], "www.tripowin.com": ["tripowin"], "www.hisenior-iem.com": ["hisenior"],
    "www.nicehck.com": ["nicehck"], "epzaudio.com": ["epz"], "www.campfireaudio.com": ["campfire"],
    "www.64audio.com": ["64"], "www.etymotic.com": ["etymotic"], "www.westoneaudio.com": ["westone"],
    "www.kineraaudio.com": ["kinera"], "fatfreq.com": ["fatfreq"], "www.hiby.com": ["hiby"],
}
# official product pages (og:image), for brands without a Shopify feed: base model -> url
PAGES = {
    "Sony IER-M9": "https://www.sony.com/en/articles/product-specifications/ier-m9",
    "Sony WF-1000XM5": "https://electronics.sony.com/audio/headphones/truly-wireless-earbuds/p/wf1000xm5-b",
    "Sony MH755": "https://www.sony.co.uk/electronics/support/headphones-headsets-in-ear/mh755",
    "Sony XBA-A2": "https://www.sony.co.uk/electronics/in-ear-headphones/xba-a2",
    "Sony MDR-EX1000": "https://www.sony.co.uk/electronics/support/headphones-headsets-in-ear/mdr-ex1000",
    "Sony MDR-EX15LP": "https://www.sony.co.uk/electronics/in-ear-headphones/mdr-ex15lp-ex15ap",
    "JVC HA-FDX1": "https://www.jvc.com/usa/headphones/premium/ha-fdx1/",
    "JVC HA-FW1800": "https://www.jvc.com/global/products/headphones/ha-fw1800/",
    "JVC HA-FW1000T": "https://www.jvc.com/global/products/headphones/ha-fw1000t/",
    "JVC HA-FD01": "https://www.jvc.com/usa/headphones/premium/ha-fd01/",
    "JVC HA-FX7 Gumy": "https://www.jvc.com/usa/headphones/in-ear/ha-fx7/",
    "Samsung Galaxy Buds2 Pro": "https://www.samsung.com/us/mobile-audio/galaxy-buds2-pro/",
    "Samsung Galaxy Buds Pro": "https://www.samsung.com/us/mobile-audio/galaxy-buds-pro/",
    "Samsung Galaxy Buds2": "https://www.samsung.com/us/mobile-audio/galaxy-buds2/",
    "Samsung Galaxy Buds Plus": "https://www.samsung.com/us/mobile-audio/galaxy-buds-plus/",
}

# leading words that belong to a multi-word brand name ("Unique Melody", "Sound Rhyme", "Ice Lab")
BRAND_WORDS = {"audio", "acoustics", "acoustic", "ascoustics", "technics", "technology", "lab", "labs", "ears",
               "melody", "oblivion", "rhyme", "empire", "wold", "omega", "delta", "and", "of", "queen", "harmonic",
               "fly"}
OPTIONAL_BRAND = {"audio", "acoustics", "acoustic", "ascoustics", "technics", "technology", "lab", "labs", "and", "of"}
BRAND_EQUIV = {"rose": {"rose", "roseselsa"}, "roseselsa": {"rose", "roseselsa"}, "soundpeat": {"soundpeat", "soundpeats"},
               "soundpeats": {"soundpeat", "soundpeats"}, "zempireaudio": {"zempire"}, "vison": {"vision"},
               "massdrop": {"massdrop", "drop"}, "hi": {"hifri", "hi"}, "geek": {"geek"}}
BRAND_ONE_WORD = {"hi fri": "hifri", "io": "io", "i o": "io"}

# variant suffixes that don't change which model it is (applied repeatedly at the end of the name)
COLOR = r"(black|white|red|grey|gray|silver|gold|blue|green|clear|purple|pink|hollow|solid|red grey|black red)"
VARIANT = [re.compile(r"\s+" + p + r"$", re.I) for p in (
    r"stock( \d)?", r"modded|modified|mod", r"no tape", r"(2nd|\d{4}|new|old) unit", r"recable", r"new",
    r"-?jaytiss.*", r"custom tuned", r"\d*\s*foam( f\d+)?", r"f\d\d", r"(\w+ )?nozzles?", r"(\w+ )?filters?",
    r"(\w+ )?position", r"switch( \w+)*", r"smooth|sticky", r"3\.5 ?mm|4\.4 ?mm|usb-?c|type-?c",
    r"m12|m15|m20|mx|empty", r"(tw|st|tt)\d\d", r"f\.\w+", r"\(?(on|off)(-(on|off))*\)?", r"[01]{3}",
    r"\w+ version", r"anc|pass through|transparency", r"universal( iems?)?", r"iems?|in ear monitors", COLOR,
)]


def get(url, tries=2, accept_json=False):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json" if accept_json else "*/*"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404, 410):
                return None
            time.sleep(4 * (i + 1))
        except Exception:
            time.sleep(4 * (i + 1))
    return None


def shop_products(domain):
    """Live products of a Shopify shop: [{title, url, images}] (cached)."""
    cache = RAW / "shops" / f"{domain}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    out = []
    for page in range(1, 30):
        body = get(f"https://{domain}/products.json?limit=250&page={page}", accept_json=True)
        time.sleep(DELAY)
        try:
            ps = json.loads(body)["products"] if body else []
        except Exception:
            ps = []
        print(f"  {domain} page {page}: {len(ps)}", flush=True)
        if not ps:
            break
        for p in ps:
            out.append({"title": p["title"], "url": f"https://{domain}/products/{p['handle']}",
                        "images": [i["src"] for i in p.get("images", [])][:4]})
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"{domain}: {len(out)} products", flush=True)
    return out


def cores(name):
    """The name, then the name with variant suffixes removed one at a time."""
    out, s = [name], name.strip()
    while True:
        for rx in VARIANT:
            t = rx.sub("", s).strip(" -")
            if t != s and len(tokens(t)) >= 2:
                s = t
                out.append(s)
                break
        else:
            return list(dict.fromkeys(out))


def split_brand(name):
    """(required brand tokens, model tokens)."""
    t = tokens(name)
    low = " ".join(t)
    for k, v in BRAND_ONE_WORD.items():
        if low.startswith(k + " "):
            t = [v] + t[len(k.split()):]
            break
    i = 1
    while i < len(t) - 1 and t[i] in BRAND_WORDS:
        i += 1
    brand = [b for b in t[:i] if b not in OPTIONAL_BRAND] or t[:1]
    return brand, t[i:]


def brand_ok(brand, title_tok, shop_brand):
    first = brand[0]
    equiv = BRAND_EQUIV.get(first, {first})
    if shop_brand and equiv & set(shop_brand):
        return True
    joined = "".join(title_tok)
    return (any(e in title_tok for e in equiv) or any(joined.find(e) >= 0 and len(e) >= 5 for e in equiv)) \
        and all(b in title_tok for b in brand[1:])


def model_hit(model, brand, tt):
    """Model tokens contiguous in tt, followed by nothing that changes the model, preceded by brand/start."""
    n = len(model)
    for i in range(len(tt) - n + 1):
        if tt[i:i + n] != model:
            continue
        nxt = tt[i + n] if i + n < len(tt) else None
        prev = tt[i - 1] if i > 0 else None
        if not allowed_next(nxt):
            continue
        if {"for", "compatible", "replacement", "comply", "truegrip"} & set(tt[:i]) or prev == "with":
            continue  # "tips for <model>" is an accessory
        if prev is None or prev in brand or prev in ("bleqk",) or prev in OPTIONAL_BRAND or prev in GENERIC or prev in BRAND_EQUIV.get(brand[0], {brand[0]}):
            return True
        if len(model) >= 2 and not prev.isdigit():  # a long model name after an unrelated word is still the model
            return True
    return False


def index(items):
    """token -> items containing it, so a model is only compared with titles sharing its first word."""
    idx = {}
    for it in items:
        for t in set(it["tok"]):
            idx.setdefault(t, []).append(it)
    return idx


def load_products():
    prods = []
    for rank, d in enumerate(list(NEW_SHOPS) + DOMAINS):
        src = STORE_CACHE / f"{d}.json"
        ps = json.loads(src.read_text(encoding="utf-8")) if d in DOMAINS and src.exists() else shop_products(d)
        sb = NEW_SHOPS.get(d) if d in NEW_SHOPS else OLD_BRAND_SHOPS.get(d)
        for p in ps:
            if p.get("images") and not ACCESSORY.search(p["title"]) and not re.search(r"open box|b-stock|refurb|deposit|reservation|中古|preowned|pre-owned|用|ケース|ケーブル|イヤーピース|イヤーチップ", p["title"], re.I):
                prods.append({"title": p["title"], "url": p["url"], "images": p["images"], "store": d,
                              "rank": rank - (100 if sb else 0), "brand": sb, "tok": tokens(p["title"])})
    return prods


def wayback_handles():
    out = []
    for f in sorted(WAYBACK_CACHE.glob("*.txt")):
        shop = f.stem
        sb = OLD_BRAND_SHOPS.get(shop)
        for h in f.read_text(encoding="utf-8").split():
            if not re.search(r"reservation|deposit|card|cable|tips|eartip|case|pouch|adapter|filter|nozzle|bundle|combo|"
                             r"preorder|pre-order|open-box|b-stock|refurb", h):
                out.append({"shop": shop, "handle": h, "brand": sb, "tok": tokens(h)})
    return out


def to_thumb(img):
    transparent = "A" in img.getbands() or "transparency" in img.info
    img = img.convert("RGBA" if transparent else "RGB")
    img.thumbnail((SIZE, SIZE))
    if transparent:
        a = np.asarray(img)[..., 3]
        border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
        return img, (border < 30).mean() >= 0.85
    rgb = np.asarray(img)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    light = np.median(border, axis=0).mean() >= 200  # dark "plain" backgrounds are mostly lifestyle shots
    return img, light and plainness(rgb) >= 0.85


def fetch_img(url, archived=False):
    urls = [url + ("&" if "?" in url else "?") + f"width={SIZE * 2}"] if "cdn.shopify" in url or "/cdn/shop/" in url else [url]
    urls.append(url)
    if archived:
        urls.append(f"http://web.archive.org/web/0id_/{url}")
    for u in dict.fromkeys(urls):
        data = get(u)
        time.sleep(0.4)
        if data:
            try:
                img = Image.open(io.BytesIO(data))
                img.load()
                return img
            except Exception:
                continue
    return None


def pick(image_urls, archived=False):
    for u in image_urls[:3]:
        if u.startswith("//"):
            u = "https:" + u
        img = fetch_img(u, archived)
        if img is None:
            continue
        img, plain = to_thumb(img)
        if plain:
            return img
    return None


def save(img, name, made):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    dest = IMG_DIR / f"{slug}.webp"
    if dest.exists() and dest.name not in made:
        slug += "-c"
        dest = IMG_DIR / f"{slug}.webp"
    if dest.exists() and dest.name not in made:
        return None
    img.save(dest, "WEBP", quality=70, method=6)
    clean(dest)
    made.add(dest.name)
    return f"img/iem/{slug}.webp"


def og_image(url):
    body = get(url)
    time.sleep(DELAY)
    if not body:
        return None
    m = re.search(rb'property="og:image"\s+content="([^"]+)"', body) or re.search(rb'content="([^"]+)"\s+property="og:image"', body)
    return m.group(1).decode() if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(RAW / "missing_group_c.json"))
    ap.add_argument("--no-wayback", action="store_true")
    ap.add_argument("--max-wayback", type=int, default=400)
    ap.add_argument("--skip-live", action="store_true", help="skip stage 1 (live shop feeds)")
    ap.add_argument("--live-from", default="", help="stage 1 only looks at model names sorting at/after this")
    ap.add_argument("--reject", nargs="+", help="image files (e.g. foo.webp) checked by eye as wrong")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    groups = json.loads(Path(args.input).read_text(encoding="utf-8"))
    models = {n: ids for b in groups.values() for n, ids in b.items()}
    RAW.mkdir(parents=True, exist_ok=True)
    state_f = RAW / "state.json"
    state = json.loads(state_f.read_text(encoding="utf-8")) if state_f.exists() else {"tried": {}, "made": []}
    made = set(state["made"])
    found = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    rejected_f = RAW / "rejected.txt"  # urls checked by eye as wrong photos
    rejected = set(rejected_f.read_text(encoding="utf-8").split()) if rejected_f.exists() else set()
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    if args.reject:  # photos checked by eye as wrong: forget them and never pick that page again
        for src in args.reject:
            src = src if src.startswith("img/") else f"img/iem/{src}"
            urls = {v["url"] for v in found.values() if v["src"] == src}
            for i in [i for i, v in found.items() if v["src"] == src]:
                del found[i]
            for n in [n for n, r in state["tried"].items() if any(r.endswith(" " + u) for u in urls)]:
                del state["tried"][n]
            f = ROOT / "app" / "public" / src
            if f.name in made and f.exists():
                f.unlink()
                made.discard(f.name)
            # archived pages are rejected by their shop/handle, live ones by url
            keys = {re.sub(r"^https://web\.archive\.org/web/\d+/(?:https?://)?([^/]+)/products/([^/?#]+).*", r"\1/\2", u) for u in urls}
            rejected |= urls | keys
            print("rejected", src, urls)
        rejected_f.write_text("\n".join(sorted(rejected)) + "\n", encoding="utf-8")
        state["made"] = sorted(made)
        state_f.write_text(json.dumps(state, indent=0, ensure_ascii=False), encoding="utf-8")
        OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        return

    def record(n, src, store, url, title):
        for i in models[n]:
            found[i] = {"src": src, "store": store, "url": url, "title": title}
        state["tried"][n] = f"{store} {url}"

    def flush():
        state["made"] = sorted(made)
        state_f.write_text(json.dumps(state, indent=0, ensure_ascii=False), encoding="utf-8")
        OUT.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # photos already made for one base core are shared by every variant with the same core
    by_core = {}

    def done(n):
        return all(i in found for i in models[n])

    # 1. live shop feeds
    prods = {} if args.skip_live else index(load_products())
    for n in sorted(models):
        if args.skip_live or n < args.live_from or done(n) or n in state["tried"]:
            continue
        hit = None
        for c in cores(n):
            if c in by_core:
                hit = by_core[c]
                break
            brand, model = split_brand(c)
            if not model or (len(model) == 1 and len(model[0]) < 2):
                continue
            hits = [p for p in prods.get(model[0], []) if p["url"] not in rejected and brand_ok(brand, p["tok"], p["brand"]) and model_hit(model, brand, p["tok"])]
            if not hits:
                continue
            best = min(hits, key=lambda p: (p["rank"], len(p["tok"])))
            if len({p["title"].lower() for p in hits if p["store"] == best["store"]}) > 3:
                print(f"{n}: ambiguous at {best['store']} ({c})", flush=True)
                continue
            for p in sorted(hits, key=lambda p: (p["rank"], len(p["tok"])))[:2]:
                img = pick(p["images"])
                if img is None:
                    continue
                src = save(img, c, made)
                if src:
                    hit = (src, p["store"], p["url"], p["title"])
                    by_core[c] = hit
                    break
            if hit:
                break
        if hit:
            record(n, *hit)
            print(f"{n}: {hit[1]} | {hit[3]}", flush=True)
        else:
            state["tried"][n] = "s1: none"
        flush()

    # 2. official product pages (og:image)
    for n, url in PAGES.items():
        if n not in models or done(n) or url in rejected:
            continue
        u = og_image(url)
        img = pick([u]) if u else None
        if img is not None:
            src = save(img, n, made)
            if src:
                record(n, src, url.split("/")[2], url, n)
                print(f"{n}: page {url}", flush=True)
                flush()

    # 3. archived shop pages
    if not args.no_wayback:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from wayback_images import product_images  # noqa: E402
        hs = index(wayback_handles())
        rank = {s: i for i, s in enumerate(DOMAINS)}
        looked = 0
        for n in sorted(models):
            if done(n) or state["tried"].get(n, "").startswith("wb:") or looked >= args.max_wayback:
                continue
            hit = None
            for c in cores(n):
                if c in by_core:
                    hit = by_core[c]
                    break
                brand, model = split_brand(c)
                if not model:
                    continue
                cands = [h for h in hs.get(model[0], []) if f"{h['shop']}/{h['handle']}" not in rejected and brand_ok(brand, h["tok"], h["brand"])
                         and model_hit(model, brand, h["tok"])]
                if not cands:
                    continue
                looked += 1
                cands.sort(key=lambda h: (h["brand"] is None, rank.get(h["shop"], 99), len(h["handle"])))
                for h in cands[:2]:
                    imgs, page, title = product_images(h["shop"], h["handle"])
                    if not imgs or ACCESSORY.search(title or ""):
                        continue
                    img = pick(imgs, archived=True)
                    if img is None:
                        continue
                    src = save(img, c, made)
                    if src:
                        hit = (src, f"{h['shop']} (archived)", page, title)
                        by_core[c] = hit
                        break
                if hit:
                    break
            if hit:
                record(n, *hit)
                print(f"{n}: {hit[1]} | {hit[3]}", flush=True)
            else:
                state["tried"][n] = "wb: none"
            flush()
    flush()
    got = [n for n in models if done(n)]
    print(f"done: {len(got)}/{len(models)} base models, {len(found)}/{sum(len(v) for v in models.values())} ids", flush=True)


if __name__ == "__main__":
    main()
