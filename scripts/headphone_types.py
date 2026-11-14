"""Headphone type tags: open / semi-open / closed back, over- / on-ear.

In order: words in the name ("Aeon 2 Closed", "on-ear"), Fernanda Gunsan's sheet (`type` column,
data/kitab.json), then a hand list of well-known models and lines. Nothing found -> no tag
("unknown" in the app). Used by build_headphone_data.py; run on its own to tag the current
headphones.json in place.

Usage: python -I scripts/headphone_types.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
from names import base, key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
KITAB = ROOT / "data" / "kitab.json"
OUT = ROOT / "app" / "public" / "data" / "headphones.json"

O, S, C = "open", "semi-open", "closed"

# (pattern on the lowercased model name without its "(…)" variant, back, fit); first match wins.
# fit None = over-ear unless something says on-ear.
KNOWN = [
    # Sennheiser
    (r"sennheiser.*\bhd ?(25 ?1?|26)\b", C, "on"),
    (r"sennheiser.*\bhd ?(200|201|202|203|205|206|215|219|229|250|280|300|380|450|458|4\.\d0|569|599 ?se|620|630|820|8 dj)", C, None),
    (r"sennheiser.*\b(momentum|accentum|pxc|px ?\d|urbanite|hdb ?630|rs ?1[0-9]{2}|gsp ?[3-6]\d\d|game zero|hme)", C, None),
    (r"sennheiser.*\bhd ?(4\d\d|5\d\d|6\d\d|6xx|58x|660|800|25 pro)|sennheiser.*\bhe ?[19]|sennheiser.*\bhd ?490|(drop|massdrop).*\b(hd ?6xx|hd ?58x|hd ?8xx)", O, None),
    (r"\bpc ?3[78] ?x\b", O, None),
    # Beyerdynamic
    (r"beyerdynamic.*\b(dt ?770|dt ?1770|dt ?250|dt ?150|dt ?240|dt ?700|t ?5|custom one|custom studio|custom game|mmx ?\d+|amiron wireless|aventho|lagoon|xelento)", C, None),
    (r"beyerdynamic.*\bdt ?880", S, None),
    (r"beyerdynamic.*\b(dt ?990|dt ?1990|dt ?900|t ?1|amiron(?! wireless)|dt ?177x go)", O, None),
    # HiFiMAN
    (r"hifiman.*\b(he-?r9|he-?r10|edition s\b|sundara[- ]c\b|sundara closed)", C, None),
    (r"hifiman|\bhe-?400 ?se\b", O, None),
    # Audeze
    (r"audeze.*\b(lcd-?xc|lcd-?2 closed|lcd-?5c|maxwell|mobius|penrose|lcd-?gx closed|sine|el-?8 closed|crbn)", C, None),
    (r"audeze", O, None),
    # Focal
    (r"focal.*\b(stellia|celestee|radiance|elegia|azurys|bathys|listen|spirit|sphear|elear closed|hadenys closed|aurora|elie)", C, None),
    (r"focal.*\b(clear|utopia|elex|elear|hadenys|bathys open|arche|azurys open)", O, None),
    # Dan Clark
    (r"(dan clark|mrspeakers|dca).*\b(closed|stealth|e3|noire? x(?!o)|ether ?c|mad dog|alpha dog)", C, None),
    (r"(dan clark|mrspeakers|dca).*\b(open|expanse|ether|aeon|noire? xo|corina|voce)", O, None),
    # AKG
    (r"akg.*\b(k ?240|k ?141|k ?271|k ?272)\b", S, None),
    (r"akg.*\bk ?(4\d\d|518)\b", C, "on"),
    (r"akg.*\b(k ?(361|371|275|245|550|551|553|52|72|92|182|171|172|167|175|181|545|845|872)|n\d0|y\d\d)", C, None),
    (r"akg.*\bk ?(701|702|712|7xx|612|601|501|500|1000|812)\b", O, None),
    # Audio-Technica
    (r"audio[- ]?technica.*\bath-?(on|s|ep)\d+", C, "on"),
    (r"audio[- ]?technica.*\bath-?(m\d+x?|msr|a\d+|w\d+|l\d+|es\d+|ws\d+|sr\d+|anc\d+|dsr|pro\d+|g1\b|awkt|awas|ap\d+|wp\d+)", C, None),
    (r"audio[- ]?technica.*\bath-?(ad\w+|r\d+x|hl\d+|ava\d+)", O, None),
    # Sony
    (r"sony.*\b(mdr-?mv1|mdr-?sa\d+|mdr-?ma\d+|mdr-?f1)\b", O, None),
    (r"sony.*\b(mdr-?(7506|v\d+|cd\d+|z1r|z7|zx\d+|1a|1r|100|m1|xb\d+|rf\d+|10r|7510|7520|hw\d+)|wh-|inzone|ult wear|wh\d+)", C, None),
    # Meze
    (r"meze.*\b(105|109|poet|empyrean|elite)", O, None),
    (r"meze.*\b(99|liric|neo|classics)", C, None),
    # Grado: open, on-ear except the GS/PS/Hemp over-ear bowls
    (r"grado.*\b(gs ?\d+|ps ?\d+|hemp|signature hp)", O, "over"),
    (r"grado", O, "on"),
    # Koss
    (r"koss.*\b(porta ?pro|ksc ?75|ksc ?35|kph ?30|kph ?40|ksc ?50|sporta)", O, "on"),
    (r"koss.*\besp", O, None),
    (r"koss.*\b(pro ?4|ur)", C, None),
    # Philips
    (r"phil+ips.*\b(shp ?9500|shp ?9600|x2|x3|fidelio x)", O, None),
    (r"phil+ips.*\b(shp ?(1900|2000)|fidelio l|tah|tat|shl|shb)", C, None),
    # Fostex
    (r"fostex.*\bt\d0rp", S, None),
    (r"fostex.*\b(th-?\d+|th-?x\d+|trx\d+)", C, None),
    # ZMF
    (r"zmf.*\b(atticus|eikon)", C, None),
    (r"zmf.*\b(aeolus|auteur|verite|vérité|caldera|atrium|bokeh|lokahi)", O, None),
    # others
    (r"moondrop.*\bold fashioned", O, "on"),
    (r"moondrop.*\b(para|venus|cosmo)", O, None),
    (r"fiio.*\b(ft ?1 ?pro|ft3|ft5|ft7|jt7|jt3)", O, None),
    (r"fiio.*\b(ft1|jt1|eh\d+|bt\d+)\b", C, None),
    (r"sivga.*\b(phoenix|luan|nightingale|peacock|p-?ii)", O, None),
    (r"sivga.*\b(robin|oriole)", C, None),
    (r"harmonicdyne.*\b(zeus|athena|helios|poseidon)", O, None),
    (r"final.*\b(d8000|d7000)", O, None),
    (r"final.*\b(sonorous|ux\d+)", C, None),
    (r"\bspirit s\d", C, None),
    (r"abyss|raal|warwick|stax|hedd|kingsound|shangri-?la|grell.*\boae|yamaha.*\byh-?5000", O, None),
    (r"(sennheiser|stax).*\bhe-?(1|60|90)\b", O, None),
    (r"shure.*\bsrh ?(1840|1440)", O, None),
    (r"shure.*\b(srh ?\d+|aonic)", C, None),
    (r"verum.*\b(1|one|2)\b", O, None),
    (r"aune.*\bsr\d+", C, None),
    (r"aune.*\bar\d+", O, None),
    (r"denon.*\bah-?(d\d+|mm\d+|gc\d+)", C, None),
    (r"superlux.*\bhd ?(668|681|662|660)", S, None),
    (r"superlux.*\bhd ?(669|330|651)", C, None),
    (r"samson.*\bsr ?850", S, None),
    (r"oppo.*\bpm-?[123]", O, None),
    (r"xk audio.*\bserene", O, None),
    (r"yamaha.*\bhph-?mt", C, None),
    (r"tanchjim.*\brita|takstar.*\bpro ?8[02]|pioneer.*\b(hdj|se-?m\d+)", C, None),
    # brands whose headphones are all closed (wireless, gaming, consumer)
    (r"ultrasone|v-moda|beats|bose|skullcandy|steelseries|hyperx|logitech|razer|turtle beach|corsair|astro|jbl|marshall|"
     r"bowers|b&w|bang|b&o|cleer|soundcore|anker|edifier|jabra|apple|airpods max|sonos|dyson|plantronics|epos|lucidsound|"
     r"nothing|1more|monster|master ?& ?dynamic|polk|klipsch|jvc|panasonic|technics|acezone|fractal design|haylou|ugreen|"
     r"\bcmf\b|valco|noble audio|neuropunk", C, None),
    (r"wireless|bluetooth|\banc\b", C, None),
]
KNOWN_RE = [(re.compile(p), back, fit) for p, back, fit in KNOWN]


def kitab_types() -> dict[str, tuple]:
    """key(base name) -> (back, fit) from Fernanda's `type` column, for his headphone rows."""
    if not KITAB.exists():
        return {}
    out = {}
    for e in json.loads(KITAB.read_text(encoding="utf-8"))["entries"]:
        t = (e.get("type") or "").lower().replace(" ", "")
        if not e["kind"].startswith("headphone") or not t:
            continue
        back = S if "semiopen" in t else O if "open" in t else C if "closed" in t else None
        fit = "on" if "onear" in t and "semion" not in t else None
        if back or fit:
            out[key(base(e["name"]))] = (back, fit)
    return out


def words(name: str) -> tuple:
    n = name.lower()
    back = S if re.search(r"semi[- ]?open", n) else \
        C if re.search(r"\bclosed\b|closed[- ]back|\bclose[- ]back", n) else \
        O if re.search(r"\bopen[- ]?back\b|\bopen\b(?![- ]?(pads?|grill|mod|ended|ear mode))", n) else None
    fit = "on" if re.search(r"\bon[- ]ear\b(?! mode)", base(n)) else None
    return back, fit


def headphone_type(name: str, kitab: dict) -> dict:
    """{"back": open|semi-open|closed, "fit": over|on}; a field is left out when nothing says."""
    back, fit = words(base(name))
    kb, kf = kitab.get(key(base(name)), (None, None))
    back, fit = back or kb, fit or kf
    if not back or not fit:
        m = base(name).lower()
        for rx, b, f in KNOWN_RE:
            if rx.search(m):
                back, fit = back or b, fit or f
                break
    out = {}
    if back:
        out["back"] = back
    if fit or back:  # most headphones are over-ear; on-ears are named or listed
        out["fit"] = fit or "over"
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    data = json.loads(OUT.read_text(encoding="utf-8"))
    kitab = kitab_types()
    counts = {}
    for hp in data["iems"]:
        hp.pop("back", None)
        hp.pop("fit", None)
        hp.update(headphone_type(hp["name"], kitab))
        tag = f"{hp.get('back', 'unknown')} / {hp.get('fit', 'unknown')}"
        counts[tag] = counts.get(tag, 0) + 1
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    for tag, n in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {n:5}  {tag}")


if __name__ == "__main__":
    main()
