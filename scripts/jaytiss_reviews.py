"""Jaytiss's ranking sheet (IEMs, TWS/DSP, headphones) as reviewer comments in reviews.json.

The sheet (Google Sheet, Excel export) has a row per model: overall score, tier (S+ … F),
price, a 🌟/😍 mark, his 1–10 scores (Dynamics/bass, Mids, Treble, Soundstage/X-factor), his take,
and for IEMs how he got the unit, signature, drivers and connector. Column titles are pictures in
the sheet, so the layout is fixed here (checked 2026-10-29). His "My 5 Star iems" tab adds why a
model got its star.

Rows link to the catalog on normalised names like Fernanda's (scripts/kitab_reviews.py):
IEMs/TWS to iems.json, headphones to headphones.json; a linked id that aliases.json merges away
points at the kept model. Hand-checked links: data/jaytiss_aliases.json (sheet name -> catalog
name); the rest goes to data/jaytiss_unmatched.txt.

`python -I scripts/jaytiss_reviews.py <export.xlsx>` parses to data/jaytiss.json and puts his
comments into app/public/data/reviews.json (replacing earlier Jaytiss ones, nothing else
touched). scripts/build_reviews.py also calls jaytiss_comments() on a full rebuild.
  export: https://docs.google.com/spreadsheets/d/1aBAj-f2iaNSzTCcN4yoPQyBhFiEFooM-7WM9CHUS-Cs/export?format=xlsx
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from names import base, key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "public" / "data"
PARSED = ROOT / "data" / "jaytiss.json"
ALIASES = ROOT / "data" / "jaytiss_aliases.json"
UNMATCHED = ROOT / "data" / "jaytiss_unmatched.txt"
REVIEWER = "Jaytiss"
URL = "https://www.youtube.com/@jaytiss"

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

# sheet -> (kind, column letters); scores in the sheet's own order
LAYOUT = {
    "IEMS": ("iem", dict(name="A", overall="B", tier="C", price="D", stars="E", dynamics="F", mids="G", treble="H",
                         soundstage="I", take="J", hot="K", acquired="L", signature="M", drivers="N", connector="O")),
    "TWS and DSP": ("tws", dict(name="A", overall="B", tier="C", type="D", price="E", take="F")),
    "Headphones": ("headphone", dict(name="A", overall="B", tier="C", type="D", stars="E", price="F", dynamics="G",
                                     mids="H", treble="I", soundstage="J", take="K")),
}
FIVE_STAR = "My 5 Star iems"
SCORES = ("dynamics", "mids", "treble", "soundstage")
TIER = re.compile(r"^[SABCDEF][+-]?$")


def read_sheets(xlsx: str) -> dict[str, dict[int, dict[str, str]]]:
    z = zipfile.ZipFile(xlsx)
    ss = ["".join(t.text or "" for t in si.iter(M + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(M + "si")]
    rels = {e.get("Id"): e.get("Target") for e in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for sh in ET.fromstring(z.read("xl/workbook.xml")).iter(M + "sheet"):
        path = "xl/" + rels[sh.get(RID)].lstrip("/").replace("xl/", "")
        rows = {}
        for row in ET.fromstring(z.read(path)).iter(M + "row"):
            cells = {}
            for c in row.iter(M + "c"):
                v = c.find(M + "v")
                if v is None:
                    continue
                val = ss[int(v.text)] if c.get("t") == "s" else v.text
                if val and val.strip():
                    cells[re.match(r"[A-Z]+", c.get("r")).group()] = val.strip()
            if cells:
                rows[int(row.get("r"))] = cells
        out[sh.get("name")] = rows
    return out


def num(s):
    try:
        return round(float(s), 3)
    except (TypeError, ValueError):
        return None


def parse(xlsx: str) -> list[dict]:
    sheets = read_sheets(xlsx)
    why = {}
    for cells in sheets.get(FIVE_STAR, {}).values():
        if TIER.match(cells.get("B", "")) and cells.get("D"):
            why[key(cells["A"])] = cells["D"]
    entries = []
    for sheet, (kind, cols) in LAYOUT.items():
        for r, cells in sorted(sheets.get(sheet, {}).items()):
            get = lambda f: cells.get(cols[f]) if f in cols else None  # noqa: E731
            name, tier = get("name"), get("tier")
            if not name or not tier or not TIER.match(tier):
                continue  # headers, notes, links
            e = {"kind": kind, "row": r, "name": re.sub(r"\s+", " ", name), "tier": tier, "overall": num(get("overall")),
                 "price": num(get("price")), "take": get("take") or ""}
            stars = get("stars") or ""
            e["star"] = "🌟" in stars
            e["love"] = "😍" in stars
            scores = {f: num(get(f)) for f in SCORES if num(get(f)) is not None}
            if scores:
                e["scores"] = scores
            for f in ("hot", "acquired", "signature", "drivers", "connector", "type"):
                if get(f):
                    e[f] = get(f)
            if key(name) in why:
                e["starWhy"] = why[key(name)]
            entries.append(e)
    return entries


def make_linker(iems: list[dict], headphones: list[dict], aliases: dict[str, str]):
    """link(kind, sheet name) -> catalog id or None: exact normalised name, else the model's plain row.
    `aliases`: sheet name -> catalog name, checked by hand. Shared by the other ranking sheets."""

    def index(items):
        by_key, by_base = {}, defaultdict(set)
        for i in items:
            by_key.setdefault(key(i["name"]), i["id"])
            by_base[key(base(i["name"]))].add(i["id"])
        return by_key, by_base

    iem_idx, hp_idx = index(iems), index(headphones)
    names = {i["id"]: i["name"] for i in [*iems, *headphones]}

    def link(kind: str, name: str):
        by_key, by_base = hp_idx if kind == "headphone" else iem_idx
        for n in [aliases.get(name), name, re.sub(r"\s*\(.*?\)", "", name)]:
            if not n:
                continue
            k = key(n)
            if k in by_key:
                return by_key[k]
            ids = by_base.get(k, ())
            if ids:  # one model measured several ways: the plain name, else the first
                return min(ids, key=lambda i: ("(" in names[i], names[i]))
        return None

    return link


def jaytiss_comments(iems: list[dict], headphones: list[dict], merge: dict[str, str]) -> tuple[dict, list[str]]:
    """IEM id -> his comments, for reviews.json; plus the rows that found no model."""
    if not PARSED.exists():
        return {}, []
    entries = json.loads(PARSED.read_text(encoding="utf-8"))["entries"]
    aliases = json.loads(ALIASES.read_text(encoding="utf-8")) if ALIASES.exists() else {}
    link = make_linker(iems, headphones, aliases)

    comments, unmatched = defaultdict(list), []
    for e in entries:
        target = link(e["kind"], e["name"])
        if not target:
            unmatched.append(f"{e['kind']:10} {e['name']}")
            continue
        target = merge.get(target, target)
        grade = " · ".join(x for x in (
            f"Tier {e['tier']}",
            f"{e['overall']:g}/10" if e.get("overall") is not None else "",
            "🌟 5-star pick" if e.get("star") else "😍" if e.get("love") else "",
        ) if x)
        facts = " · ".join(x for x in (e.get("signature"), e.get("drivers"), e.get("type")) if x and len(x) < 60)
        comments[target].append({
            "reviewer": REVIEWER,
            "sourceType": "ranking-list",
            "grade": grade,
            "verdict": e.get("starWhy") or None,
            "quote": e["take"] or e.get("hot") or "",
            "hotTake": e.get("hot") if e["take"] and e.get("hot") else None,
            "facts": facts or None,
            "scores": e.get("scores"),
            "url": URL,
            "timestamp": None,
        })
    return comments, unmatched


def put_comments(reviewer: str, comments: dict):
    """Replace one reviewer's comments in app/public/data/reviews.json; everyone else's stay as they are."""
    path = DATA / "reviews.json"
    reviews = json.loads(path.read_text(encoding="utf-8"))
    all_c = reviews.setdefault("comments", {})
    for iid in list(all_c):
        all_c[iid] = [c for c in all_c[iid] if c.get("reviewer") != reviewer]
        if not all_c[iid]:
            del all_c[iid]
    for iid, cs in comments.items():
        all_c.setdefault(iid, []).extend(cs)
    path.write_text(json.dumps(reviews, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main(xlsx: str):
    entries = parse(xlsx)
    PARSED.write_text(json.dumps({"source": "Jaytiss ranking sheet (Google Sheet, Excel export)", "entries": entries},
                                 ensure_ascii=False, indent=1), encoding="utf-8")
    kinds = defaultdict(int)
    for e in entries:
        kinds[e["kind"]] += 1
    print(f"{len(entries)} rows parsed: {dict(kinds)}")

    iems = json.loads((DATA / "iems.json").read_text(encoding="utf-8"))["iems"]
    hps = json.loads((DATA / "headphones.json").read_text(encoding="utf-8"))["iems"]
    merge = json.loads((DATA / "aliases.json").read_text(encoding="utf-8"))["merge"]
    comments, unmatched = jaytiss_comments(iems, hps, merge)
    put_comments(REVIEWER, comments)
    UNMATCHED.write_text("\n".join(sorted(set(unmatched))) + "\n", encoding="utf-8")
    print(f"{sum(len(v) for v in comments.values())} linked to {len(comments)} models; {len(unmatched)} unmatched -> {UNMATCHED.name}")


if __name__ == "__main__":
    main(sys.argv[1])
