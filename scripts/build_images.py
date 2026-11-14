"""Match measured IEMs to retailer product photos and save small WebP thumbnails.

Matching is strict: every token of the IEM's model name must appear contiguously in the
product title, and the token right after it must not change the model ("Pro", "2", "SE",
"Snow", colour editions...). Accessories (cables, tips, DACs) are skipped. Unmatched IEMs
simply get no image.

Output: app/public/img/iem/<slug>.webp (max 200 px, ~5-10 KB) and app/public/data/images.json
mapping IEM id -> {src, store, url}.

Usage: python -I scripts/build_images.py [--headphones]
  --headphones matches app/public/data/headphones.json instead (headphone titles allowed) and adds
  its photos and prices to the same files; an IEM run likewise keeps the headphone entries.
"""
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
from names import ALIASES, base  # noqa: E402
from PIL import Image  # noqa: E402
import numpy as np  # noqa: E402
from clean_backgrounds import plainness  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
from stores import DOMAINS as STORES, USD  # noqa: E402  (preference order: brands first)
CATALOG = ROOT / "app" / "public" / "data" / "iems.json"
IMG_DIR = ROOT / "app" / "public" / "img" / "iem"
OUT = ROOT / "app" / "public" / "data" / "images.json"
PRICES = ROOT / "app" / "public" / "data" / "prices.json"
SIZE = 200

ACCESSORY = re.compile(r"\b(cable|cables|ear ?tips?|eartips|dac|amp|amplifier|dongle|case|adapter|pouch|"
                       r"headphones?|over-ear|speaker|player|streamer|filter|foam|replacement|"
                       r"ear ?pads?|earpads?|pads|cushions?|covers?|trrs|headband|stand|hanger|connectors?|"
                       r"strap|grilles?|grills?)\b", re.I)
MODIFIERS = {
    "pro", "max", "ultra", "lite", "plus", "mini", "se", "le", "dsp", "tws", "x", "s", "neo", "air", "ii", "iii",
    "iv", "mk1", "mk2", "mk3", "mk4", "v2", "v3", "2", "3", "4", "5", "snow", "edition", "red", "blue", "black",
    "white", "gold", "silver", "green", "pink", "purple", "limited", "special", "gaming", "bass", "studio",
    "2023", "2024", "2025", "2026", "evo", "prime", "elite", "classic", "anniversary", "hbb", "crinacle",
}


# Words allowed right after the model name: generic descriptions only. Anything else
# ("2", "Pro", "RED", "Dusk", "Black"...) probably means a different version, so no match.
GENERIC = {
    "iem", "iems", "in", "ear", "inear", "earphone", "earphones", "earbud", "earbuds", "monitor", "monitors",
    "hifi", "hi", "fi", "headphone", "headphones", "wired", "audiophile", "flagship", "new", "upgraded",
    "dynamic", "driver", "drivers", "hybrid", "planar", "magnetic", "balanced", "armature", "electrostatic",
    "dd", "ba", "est", "bcd", "single", "dual", "triple", "quad", "with", "and", "for", "by", "the",
    "detachable", "cable", "mmcx", "0", "78mm", "pin", "official",
}
UNITS = {"dd", "ba", "est", "bcd", "bc", "pd", "pzt", "mm", "ohm", "ohms", "db", "hz", "khz"}
SPEC = re.compile(r"^\d+(dd|ba|est|bcd|bc|pd|pzt|mm|ohm|ohms|db|hz|khz)$")


def allowed_next(tok: str | None) -> bool:
    """True if the word after the model name doesn't change which model it is."""
    return tok is None or tok in GENERIC or bool(SPEC.match(tok))


def tokens(name: str) -> list[str]:
    s = name.lower().replace("+", " plus ")
    for rx, rep in ALIASES:
        s = re.sub(rx, rep, s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    # split letter/number joins so "BL03", "BL-03" and "BL 03" agree, then glue spec units back
    # on ("1dd", "10mm", "7hz") so the strict next-word rule still recognises them
    out: list[str] = []
    for part in re.findall(r"[a-z]+|\d+", s):
        if out and out[-1].isdigit() and part in UNITS:
            out[-1] += part
        else:
            out.append(part)
    return out


def find(seq, sub):
    n = len(sub)
    for i in range(len(seq) - n + 1):
        if seq[i:i + n] == sub:
            return i
    return -1


def match(iem_tokens, title_tokens):
    i = find(title_tokens, iem_tokens)
    if i < 0:
        return False
    # "Earpads for <model>", "Cable for <model>": a product made for this model, not the model
    if "for" in title_tokens[:i]:
        return False
    nxt = title_tokens[i + len(iem_tokens)] if i + len(iem_tokens) < len(title_tokens) else None
    return allowed_next(nxt)


def thumb_url(src: str) -> str:
    return src + ("&" if "?" in src else "?") + f"width={SIZE * 2}"


def main():
    hp = "--headphones" in sys.argv
    # headphone products are what we want in headphone mode, so only the other accessories are skipped
    skip = re.compile(ACCESSORY.pattern.replace("headphones?|over-ear|", ""), re.I) if hp else ACCESSORY
    products = []
    for rank, store in enumerate(STORES):
        for p in json.loads((ROOT / "data" / "raw" / "stores" / f"{store}.json").read_text(encoding="utf-8")):
            if p["images"] and not skip.search(p["title"]) and not re.search(r"open box|b-stock|refurb", p["title"], re.I):
                products.append({**p, "store": store, "rank": rank, "tok": tokens(p["title"])})

    catalog = ROOT / "app" / "public" / "data" / "headphones.json" if hp else CATALOG
    iems = json.loads(catalog.read_text(encoding="utf-8"))["iems"]
    by_base = {}
    for i in iems:
        by_base.setdefault(base(i["name"]), []).append(i["id"])

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    images, prices, matched, ambiguous = {}, {}, 0, 0
    for name, ids in sorted(by_base.items()):
        t = tokens(name)
        if len(t) < 2:  # a bare brand or one-word name is too ambiguous
            continue
        hits = [p for p in products if match(t, p["tok"])]
        if not hits:
            continue
        # prefer the preferred store, then the title with the fewest extra words
        best = min(hits, key=lambda p: (p["rank"], len(p["tok"])))
        if len({p["title"].lower() for p in hits if p["store"] == best["store"]}) > 3:
            ambiguous += 1  # many different products contain this name: probably too generic
            continue
        slug = ("hp-" if hp else "") + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        dest = IMG_DIR / f"{slug}.webp"
        if not dest.exists():
            # take the first of the product's (up to 3) photos with a plain background: the main shot
            # usually comes first; later ones are often box-contents flat-lays (also on white)
            choice, best_plain = None, -1.0
            for src in best["images"][:3]:
                try:
                    req = urllib.request.Request(thumb_url(src), headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        img = Image.open(io.BytesIO(r.read()))
                    img.load()
                    time.sleep(0.1)
                except Exception as e:
                    print(f"skip {name} image: {e}")
                    continue
                transparent = "A" in img.getbands() or "transparency" in img.info
                img = img.convert("RGBA" if transparent else "RGB")
                img.thumbnail((SIZE, SIZE))
                plain = 1.0 if transparent else plainness(np.asarray(img.convert("RGB")))
                if plain >= 0.85:
                    choice = img
                    break
                if plain > best_plain:
                    choice, best_plain = img, plain
            if choice is None:
                continue
            choice.save(dest, "WEBP", quality=70, method=6)
        # price of the main product (the one the photo comes from); the cheapest hit is often an accessory
        # median variant: the cheapest "variant" is often an add-on (tips, deposit), not the IEM
        usd = [p for p in hits if p["store"] in USD and p.get("variantPrices")]
        price_src = min(usd, key=lambda p: (p["rank"], len(p["tok"]))) if usd else None
        vp = price_src["variantPrices"] if price_src else []
        if vp:
            for iem_id in ids:
                prices[iem_id] = {"usd": round(vp[len(vp) // 2]), "store": price_src["store"], "url": price_src["url"]}
        for iem_id in ids:
            images[iem_id] = {"src": f"img/iem/{slug}.webp", "store": best["store"], "url": best["url"], "title": best["title"]}
        matched += 1

    # keep the other kind's entries (headphone ids start with "hp-")
    for path, new in ((OUT, images), (PRICES, prices)):
        if path.exists():
            for k, v in json.loads(path.read_text(encoding="utf-8")).items():
                if k.startswith("hp-") != hp:
                    new.setdefault(k, v)
    OUT.write_text(json.dumps(images, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    PRICES.write_text(json.dumps(prices, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"shop prices for {len(prices)} catalog entries")
    total = sum(p.stat().st_size for p in IMG_DIR.glob("*.webp"))
    print(f"{matched} models with images ({len(images)} catalog entries), {ambiguous} skipped as ambiguous; "
          f"{total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
