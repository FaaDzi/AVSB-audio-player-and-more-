"""Fernanda Gunsan's reviews (data/kitab.json + English in data/kitab_en/) as reviewer comments.

IEMs and TWS link to the IEM catalog, headphones to the headphone catalog, on strict normalised
names (names.key) like Jay's sheet. Some of his rows put only the brand in the name cell and the
model on the next line ("Sennheiser" / "Accentum"), so brand + first tagline words is tried too.
Hand-checked links live in data/kitab_aliases.json; whatever stays unlinked goes to
data/kitab_unmatched.txt. Used by scripts/build_reviews.py.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

from names import base, key

ROOT = Path(__file__).resolve().parent.parent
KITAB = ROOT / "data" / "kitab.json"
EN_DIR = ROOT / "data" / "kitab_en"
ALIASES = ROOT / "data" / "kitab_aliases.json"
UNMATCHED = ROOT / "data" / "kitab_unmatched.txt"
REVIEWER = "Fernanda Gunsan"
URL = "https://www.instagram.com/fernandagunsan"
SCORE_FIELDS = ("total", "bass", "loMid", "hiMid", "treble", "vocal", "soundstage", "imaging", "separation", "timbre", "punch",
                "detail", "technicality")
# Indonesian colour words in his names ("Kinera Wyvern Putih Hitam" = white/black)
COLOURS = r"\b(putih|hitam|ungu|biru|merah|blue|red|black|white|purple)\b"


def candidates(e: dict) -> list[str]:
    name = e["name"]
    out = [name, re.sub(COLOURS, "", name, flags=re.I)]
    # "Audio Technica M50x" is "Audio-Technica ATH-M50x" in the measurements
    m = re.match(r"audio[ -]?technica\s+(?!ath)(.+)", name, re.I)
    if m:
        out.append(f"Audio-Technica ATH-{m.group(1)}")
    tag = (e.get("tagline") or "").strip()
    if tag and len(name.split()) <= 2 and not re.search(r"\d", name):
        words = tag.split()
        out += [f"{name} {' '.join(words[:n])}" for n in (1, 2, 3) if len(words) >= n]
    return [c.strip() for c in out if c.strip()]


def kitab_comments(iems: list[dict], headphones: list[dict]) -> tuple[dict, list[str]]:
    if not KITAB.exists():
        return {}, []
    kitab = json.loads(KITAB.read_text(encoding="utf-8"))
    en = {}
    for f in sorted(EN_DIR.glob("*.json")):
        en.update(json.loads(f.read_text(encoding="utf-8")))
    aliases = json.loads(ALIASES.read_text(encoding="utf-8")) if ALIASES.exists() else {}

    def index(items):
        by_key = {key(i["name"]): i["id"] for i in items}
        by_base = defaultdict(set)
        for i in items:
            by_base[key(base(i["name"]))].add(i["id"])
        return by_key, by_base

    iem_idx, hp_idx = index(iems), index(headphones)
    by_name = {i["name"]: i["id"] for i in [*iems, *headphones]}
    names = {i["id"]: i["name"] for i in [*iems, *headphones]}

    def link(e: dict):
        if e["id"] in aliases:
            target = aliases[e["id"]]
            return by_name.get(target) or iem_idx[0].get(key(target)) or hp_idx[0].get(key(target))
        by_key, by_base = hp_idx if e["kind"].startswith("headphone") else iem_idx
        for c in candidates(e):
            k = key(c)
            if k in by_key:
                return by_key[k]
            ids = by_base.get(k, ())
            if len(ids) == 1:
                return next(iter(ids))
            if ids:  # one model measured several ways (ANC on/off, pads): the plain name, else the first
                return min(ids, key=lambda i: ("(" in names[i], names[i]))
        return None

    comments, unmatched = defaultdict(list), []
    for e in kitab["entries"]:
        if e["kind"] == "eartips":
            continue
        target = link(e)
        if not target:
            unmatched.append(f"{e['kind']:20} {e['name']}" + (f"  ({e['tagline']})" if e.get("tagline") else ""))
            continue
        t = en.get(e["id"], {})
        scores = {k: e[k] for k in SCORE_FIELDS if isinstance(e.get(k), (int, float))}
        grade = " · ".join(x for x in (f"Tier {e['tier']}" if e.get("tier") else "", f"value {e['value']}" if e.get("value") else "") if x)
        comments[target].append({
            "reviewer": REVIEWER,
            "sourceType": "ranking-list",
            "grade": grade or None,
            "verdict": t.get("tagline") or None,
            "quote": t.get("review") or e["review"],
            "original": e["review"],
            "translated": bool(t.get("review")),
            "scores": scores or None,
            "tips": e.get("tips"),
            "url": URL,
            "timestamp": None,
        })
    UNMATCHED.write_text("\n".join(sorted(set(unmatched))) + "\n", encoding="utf-8")
    return comments, unmatched


EARTIPS_OUT = ROOT / "app" / "public" / "data" / "eartips.json"
# his two notes at the top of the Eartips tab, translated
EARTIP_NOTES_EN = [
    "I use eartips to match an IEM's character: if it needs brightness, pick a wide bore; if it's too bright or "
    "stinging, pick one that warms it up, like a narrower bore or foam. Eartips are like helmets: once you like "
    "one brand, you'll keep wearing it whatever bike you ride.",
    "Foam follows the shape of your ear better, but for me it's less comfortable, cuts a lot of treble and makes "
    "the bass a little soft.",
]


def write_eartips():
    """app/public/data/eartips.json: his eartip tier list with English reviews (Settings → Fit check)."""
    if not KITAB.exists():
        return 0
    kitab = json.loads(KITAB.read_text(encoding="utf-8"))
    en = {}
    for f in sorted(EN_DIR.glob("*.json")):
        en.update(json.loads(f.read_text(encoding="utf-8")))
    tips = []
    for e in kitab["entries"]:
        if e["kind"] != "eartips":
            continue
        t = en.get(e["id"], {})
        tips.append({"name": e["name"], "tier": e.get("tier"), "tagline": t.get("tagline") or e.get("tagline"),
                     "useOn": e.get("useOn"), "review": t.get("review") or e["review"], "original": e["review"],
                     "usedWith": e.get("usedWith")})
    EARTIPS_OUT.write_text(json.dumps({"reviewer": REVIEWER, "url": URL, "notes": EARTIP_NOTES_EN, "tips": tips},
                                      ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(tips)
