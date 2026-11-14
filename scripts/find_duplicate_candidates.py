"""Possible duplicate models left in the catalog after aliases.json: the same IEM, TWS or
headphone listed under two names ("AFUL 5+2" / "AFUL Performer 5+2", "Aful P5+2"). For a person
(or a reviewing agent) to confirm; nothing is merged here.

A pair is a candidate when, within one brand (brand spellings folded: "AFUL Acoustics" = "AFUL",
"Tin HiFi" = "TinHiFi"), the two models share their model numbers and one name's words are
(nearly) contained in the other's, or the names are similar and the curves close. Variants of one
model ("Kato (gold nozzle)") are already grouped by the app and are skipped; so are rows already
merged by aliases.json.

Writes data/dup_candidates_{iem,tws,headphones}.json: [{a, b, idA, idB, rms, sim, why}], with the
curve difference (dB rms, 20 Hz–10 kHz, levels matched) as evidence.

Usage: python -I scripts/find_duplicate_candidates.py
"""
import json
import re
import sys
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frcodec import decode  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "public" / "data"
OUT = ROOT / "data"

# same rule as app/src/audio/wireless.ts isWirelessName, enough to split TWS out of iems.json
WIRELESS = re.compile(
    r"\bairpods\b|galaxy buds|pixel buds|\bbuds\s?(?:\d|air|pro|plus|live|fe|\+)|\bwf-\w|\bwf\d{3,4}xm\d|linkbuds|soundcore|liberty \d|freebuds|"
    r"true wireless|jabra elite|nothing ear|\bear \(\d\)|beats (?:studio buds|fit pro|powerbeats|solo buds)|\btws\d*\b|\bqcy\b|\bearfun\b|"
    r"moto buds|realme buds|oneplus buds|redmi buds|xiaomi buds|oppo enco|soundpeats|haylou|tozo\b|edifier (?:tws|neobuds|lolli)|"
    r"bose (?:quietcomfort|qc) (?:ultra )?earbuds|technics eah-az\d+|denon perl|cambridge melomania|jbl (?:tour pro|live (?:pro|free|beam|flex)|wave|vibe)",
    re.I,
)
BRAND_SUFFIX = r"(?:acoustics?|audio|hifi|hi-fi|ears?|technology|tech|electronics|labs?)"


def strip_parens(s: str) -> str:
    prev = None
    while prev != s:
        prev, s = s, re.sub(r"\s*\([^()]*\)", "", s)
    return s.strip()


def split(name: str) -> tuple[str, list[str]]:
    """(folded brand, model words) of a name without its variant part."""
    s = strip_parens(name).lower().replace("*mod ", "")
    s = re.sub(r"[^a-z0-9+.&' -]", " ", s)
    words = s.split()
    if not words:
        return "", []
    brand = words[0]
    rest = words[1:]
    while rest and re.fullmatch(BRAND_SUFFIX, rest[0]):
        rest = rest[1:]
    brand = re.sub(BRAND_SUFFIX + "$", "", brand) or brand
    # "tin hifi" / "tinhifi", "7 hz" / "7hz": fold a lone short second brand word
    if rest and brand in {"tin", "7", "thie", "kiwi", "moon", "letshuoer", "shuoer"} and len(rest) > 1:
        if rest[0] in {"hifi", "hz", "audio", "ears", "drop"}:
            brand, rest = brand + rest[0], rest[1:]
    brand = {"shuoer": "letshuoer", "thieaudio": "thie", "kiwiears": "kiwi", "tinhifi": "tin", "7hertz": "7hz"}.get(brand, brand)
    return brand, rest


NUM = re.compile(r"\d+(?:[.+]\d+)*")


def numbers(words: list[str]) -> tuple:
    return tuple(sorted(n for w in words for n in NUM.findall(w)))


def letters(words: list[str]) -> set:
    """Model words without digits, so 'p5+2' and '5+2' compare by their number."""
    return {w for w in (re.sub(r"[\d.+]", "", w) for w in words) if len(w) > 1}


# words that make another product (Pro, Max, S, II...), not another name for the same one
SUBMODEL = set("pro max plus mini lite se ultra s x air neo nano fe gt ti dsp anc bt wireless closed open studio bass "
               "edition special limited le ii iii iv mk2 mk3 mk4 v2 v3 v4 2 3 4 5 gen r t c e balanced"
               " sport elite live active hd sr dt hybrid planar dynamic".split())


# words that only name a configuration of one model (switches, filters, colours, tips, fit):
# a pair differing by just these is a variant, which the app lists apart on purpose
VARIANT = re.compile(
    r"^(?:[du]{2,4}|[a-z]?\d?[du]{2,4}|red|blue|black|gold|gld|blk|silver|green|white|grey|gray|pink|purple|orange|yellow|"
    r"filter|nozzle|nozzles|tips?|foam|silicone|stock|standard|deep|shallow|fit|insertion|on|off|bass|treble|mode|switch|"
    r"\d+\s*ohms?|ohm|ohms|rumble|boost|eq|n\.\w+|v\d|pop|pad|pads|cable|smooth/stripe|softears|velvet|spinfit|azla)$"
)


def word_diff(wa: list[str], wb: list[str]) -> set:
    return set(wa) ^ set(wb)


def curves(rows, grid):
    band = (grid >= 20) & (grid <= 10000)
    y = np.array([decode(r["fr"]) for r in rows], float)[:, band] / 10
    return y - y.mean(1, keepdims=True)


def candidates(rows, grid):
    by_brand = defaultdict(list)
    seen_model = {}
    for r in rows:
        brand, words = split(r["name"])
        if not words:
            continue
        model = " ".join(words)
        k = (brand, model)
        if k in seen_model:  # a variant of a model already listed: grouped in the app
            continue
        seen_model[k] = r
        by_brand[brand].append((r, words))
    out = []
    for brand, items in by_brand.items():
        if len(items) < 2:
            continue
        y = curves([r for r, _ in items], grid)
        for a in range(len(items)):
            ra, wa = items[a]
            na, la = numbers(wa), letters(wa)
            for b in range(a + 1, len(items)):
                rb, wb = items[b]
                nb, lb = numbers(wb), letters(wb)
                ma, mb = " ".join(wa), " ".join(wb)
                sim = SequenceMatcher(None, ma, mb).ratio()
                rms = float(np.sqrt(((y[a] - y[b]) ** 2).mean()))
                diff = word_diff(wa, wb)
                if diff and all(VARIANT.match(w) for w in diff):
                    continue  # one model's configurations, not two names for it
                other_product = bool(diff & SUBMODEL)
                if ma.replace(" ", "") == mb.replace(" ", ""):
                    why = "same model, spacing/brand spelling" if rms <= 3 else None
                elif na and na == nb and (la <= lb or lb <= la) and (la or lb) and rms <= 2 and (not other_product or rms <= 0.5):
                    why = "same model number, one name's words inside the other's"
                elif na == nb and sim >= 0.75 and rms <= 0.6 and not other_product:
                    why = "similar names, close curves"
                else:
                    why = None
                if not why:
                    continue
                out.append({"a": ra["name"], "b": rb["name"], "idA": ra["id"], "idB": rb["id"], "rms": round(rms, 2), "sim": round(sim, 2), "why": why})
    out.sort(key=lambda p: (p["rms"], -p["sim"]))
    return out


def main():
    aliases = json.loads((DATA / "aliases.json").read_text(encoding="utf-8"))
    merged = set(aliases["merge"])
    iem = json.loads((DATA / "iems.json").read_text(encoding="utf-8"))
    hp = json.loads((DATA / "headphones.json").read_text(encoding="utf-8"))
    families = tuple(f.lower() for f in aliases.get("families", {}))
    rows = [r for r in iem["iems"] if r["id"] not in merged and not r["name"].lower().startswith(families)]
    tws = [r for r in rows if WIRELESS.search(r["name"])]
    wired = [r for r in rows if not WIRELESS.search(r["name"])]
    grid = np.array(iem["grid"])
    for name, rs, g in [("iem", wired, grid), ("tws", tws, grid), ("headphones", hp["iems"], np.array(hp["grid"]))]:
        c = candidates(rs, g)
        (OUT / f"dup_candidates_{name}.json").write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{name}: {len(rs)} rows, {len(c)} candidate pairs")


if __name__ == "__main__":
    main()
