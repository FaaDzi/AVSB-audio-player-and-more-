"""
Build app/public/data/aliases.json: which IEM rows are duplicates of another, so the app
can show each IEM once without renumbering iems.json (reviews, photos, prices and saved
brackets all point at its ids).

- merge: duplicate id -> kept id. Found by a looser name key than names.key() (brand
  suffixes like "Acoustics"/"Audio", collab tags like "x Crinacle", "Stock", II -> 2) plus
  the hand-checked list in MANUAL below. The kept row is the one with a review, then a
  photo, then a price, then the most sources.
- families: name prefix -> model, for rows that are one IEM measured with different tips
  or filters (shown as variants of that model, like "(gold nozzle)" variants).

Also writes data/iem_duplicates_review.md: same-brand rows whose curves are near-identical
but whose names differ, for a person to check before adding them to MANUAL.
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
from names import key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "public" / "data"
OUT = DATA / "aliases.json"
REPORT = ROOT / "data" / "iem_duplicates_review.md"

COLLAB = r"\s+x\s+(crinacle|hbb|hawaiibadboy|gizaudio|z ?reviews?|super ?review)\b"

# duplicate name -> the name it is (checked by hand against the curves: < 0.2 dB rms apart,
# or confirmed by the user)
MANUAL = {
    "7TH ACOUSTICS RYUSEI": "QoA x 7th Acoustics Ryusei",  # aftersound's unit of the same IEM
    "7Hz Timless II": "7Hz Timeless II",
    "7Hz Salnotes Dioko": "7Hz Dioko",
    "AFUL P7": "AFUL Performer 5+2",            # user: the "7" is the 5+2 (5 BA + 2 DD); 1.2 dB from it
    "AFUL Performer 7": "AFUL Performer 5+2",
    "AFUL P7 (Aful P710)": "AFUL Performer 5+2",
    "EarAcoustic Audio Hiend Max": "EarAcoustic Audio SPA Hi-End Max",
    "Effect Audio X Elysian Pilgrim Noir": "Effect Audio X Elysian Acoustic Labs Pilgrim:Noir",
    "EPZ EPZ x Tipsy Star One": "EPZ x Tipsy Star & One",
    "Jomo Nautilus": "Jomo Audio Nautilus",
    "KZ Krilla": "KZ Krila",
    "KZ CRN/ZEX Pro": "KZ ZEX Pro",
    "NF ACOUS RA05": "NF RA05",
    "NF ACOUS RG15 x Assassin's Creed Mirage": "NF RG15 x Assassin's Creed Mirage",
    "Padsmith In Ear Monitors": "Padsmith IEM",
    "Plunge Audio Unity IEM": "Plunge Audio Unity",
    "Technics TZ700": "Technics EAH-TZ700",
    "ZiiGaat x Jays Audio Estrella": "ZiiGaat Estrella",
}

# Jay's eartip-rolling series: one Estrella, 91 tips
FAMILIES = {"ZIIGAAT x JAY ESTRELLA": "ZiiGaat Estrella"}


def loose_key(name: str) -> str:
    s = name.lower()
    s = re.sub(r"^([a-z0-9&'.-]+)\s+(acoustics?|audio|ears?)\b", r"\1", s)  # "AFUL Acoustics" -> "AFUL"
    s = re.sub(COLLAB, "", s)
    s = re.sub(r"\bstock( (ear)?tips?)?\b", "", s)
    s = re.sub(r"\biv\b", "4", re.sub(r"\biii\b", "3", re.sub(r"\bii\b", "2", s)))
    return key(s)


def main():
    iems = json.loads((DATA / "iems.json").read_text(encoding="utf-8"))
    rows = iems["iems"]
    by_name = {r["name"]: r for r in rows}
    reviews = json.loads((DATA / "reviews.json").read_text(encoding="utf-8"))["reviews"]
    images = {}
    for f in ["images.json", "images_archive.json", "images_search.json", "images_brand_a.json", "images_brand_b.json", "images_brand_c.json"]:
        p = DATA / f
        if p.exists():
            images.update(json.loads(p.read_text(encoding="utf-8")))
    prices = json.loads((DATA / "prices.json").read_text(encoding="utf-8"))

    def rank(r):
        return (r["id"] in reviews, r["id"] in images, r["id"] in prices, len(r["sources"]))

    groups = defaultdict(list)
    for r in rows:
        groups[loose_key(r["name"])].append(r)
    merge = {}
    for g in groups.values():
        if len(g) < 2:
            continue
        keep = max(g, key=rank)
        for r in g:
            if r is not keep:
                merge[r["id"]] = keep["id"]
    for dup, real in MANUAL.items():
        if dup not in by_name or real not in by_name:
            print(f"manual alias not found: {dup!r} -> {real!r}")
            continue
        merge[by_name[dup]["id"]] = by_name[real]["id"]
    # follow chains (a -> b -> c) so every duplicate points at a kept row
    for d in list(merge):
        seen = {d}
        while merge[d] in merge and merge[d] not in seen:
            seen.add(merge[d])
            merge[d] = merge[merge[d]]

    OUT.write_text(json.dumps({"merge": merge, "families": FAMILIES}, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(merge)} duplicate rows -> {OUT}")
    write_report(iems, merge)


def write_report(iems, merge):
    """Same-brand pairs with near-identical curves and different names, not yet merged."""
    grid = np.array(iems["grid"])
    band = (grid >= 20) & (grid <= 10000)
    norm = lambda n: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9+ ]", " ", n.lower())).strip()
    by_brand = defaultdict(list)
    for r in iems["iems"]:
        if r["id"] not in merge and not any(r["name"].startswith(f) for f in FAMILIES):
            by_brand[r["name"].split()[0].lower()].append(r)
    pairs = []
    for rows in by_brand.values():
        if len(rows) < 2:
            continue
        y = np.array([decode(r["fr"]) for r in rows], float)[:, band] / 10
        y -= y.mean(1, keepdims=True)
        for a in range(len(rows)):
            rms = np.sqrt(((y[a + 1:] - y[a]) ** 2).mean(1))
            for j in np.where(rms <= 0.3)[0]:
                x, z = rows[a]["name"], rows[a + 1 + j]["name"]
                if re.sub(r"\s*\(.*?\)", "", x) == re.sub(r"\s*\(.*?\)", "", z):
                    continue  # variants of one model: grouped by the app already
                pairs.append((float(rms[j]), SequenceMatcher(None, norm(x), norm(z)).ratio(), x, z))
    pairs.sort(key=lambda p: (-p[1], p[0]))
    lines = [
        "# Possible duplicate IEMs (for review)",
        "",
        "Same brand, curves within 0.3 dB rms (20 Hz–10 kHz), different names, not merged yet.",
        "Very low rms (≈0.1) usually means one measurement published under two names, but",
        "tip or filter variants can also measure this close. Add confirmed ones to MANUAL in",
        "scripts/build_iem_aliases.py. Most similar names first.",
        "",
        "| rms dB | name similarity | A | B |",
        "|---|---|---|---|",
    ] + [f"| {r:.2f} | {s:.2f} | {a} | {b} |" for r, s, a, b in pairs]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(pairs)} pairs to review -> {REPORT}")


if __name__ == "__main__":
    main()
