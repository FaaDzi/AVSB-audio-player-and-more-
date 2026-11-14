"""RequIEM's review ranking (an .xlsx shared by the user; tabs "IEMs" and "Headphones") as reviewer
comments in reviews.json.

Each row: position (🥇🥈🥉 or a number), model, range (tier S+ … F), price, a link cell and the verdict.
Where the link points at the reviewer's own write-up on Reddit (r/iems, r/inearfidelity, r/headphones),
that's the comment's link; shop links are left out.

Linking works like Jaytiss's (scripts/jaytiss_reviews.py make_linker): normalised names, hand-checked
links in data/requiem_aliases.json, the rest in data/requiem_unmatched.txt.

Usage: python -I scripts/requiem_reviews.py <RequIEM_Review_Ranking.xlsx>
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jaytiss_reviews import DATA, make_linker, put_comments, read_sheets  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PARSED = ROOT / "data" / "requiem.json"
ALIASES = ROOT / "data" / "requiem_aliases.json"
UNMATCHED = ROOT / "data" / "requiem_unmatched.txt"
REVIEWER = "RequIEM"
TABS = {"IEMs": "iem", "Headphones": "headphone"}
KINDS = ("iem", "tws", "headphone")
TIER = re.compile(r"^[SABCDEF][+-]?$")
MEDALS = {"🥇": 1, "🥈": 2, "🥉": 3}

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def review_links(xlsx: str) -> dict[str, dict[int, str]]:
    """Per tab, row -> the reviewer's Reddit write-up linked from that row."""
    z = zipfile.ZipFile(xlsx)
    rels = {e.get("Id"): e.get("Target") for e in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for sh in ET.fromstring(z.read("xl/workbook.xml")).iter(M + "sheet"):
        path = "xl/" + rels[sh.get(R + "id")].lstrip("/").replace("xl/", "")
        rel_path = path.replace("worksheets/", "worksheets/_rels/") + ".rels"
        if rel_path not in z.namelist():
            continue
        targets = {e.get("Id"): e.get("Target") for e in ET.fromstring(z.read(rel_path))}
        rows = {}
        for h in ET.fromstring(z.read(path)).iter(M + "hyperlink"):
            url = targets.get(h.get(R + "id"), "")
            if "reddit.com" in url:
                rows[int(re.search(r"\d+", h.get("ref")).group())] = url.split("?")[0]
        out[sh.get("name")] = rows
    return out


def parse(xlsx: str) -> list[dict]:
    sheets, links = read_sheets(xlsx), review_links(xlsx)
    entries = []
    for tab, tab_kind in TABS.items():
        kind = tab_kind
        for r, c in sorted(sheets.get(tab, {}).items()):
            name, tier = c.get("B"), (c.get("C") or "").strip()
            if name == "Bluetooth Model TWS":
                kind = "tws"  # the IEM tab ends with an unranked TWS list (no tier)
                continue
            if not name or not (TIER.match(tier) or (kind == "tws" and c.get("F"))):
                continue
            pos = c.get("A", "")
            price = re.sub(r"[^\d.]", "", c.get("D", ""))
            entries.append({
                "kind": kind, "row": r, "name": re.sub(r"\s+", " ", name),
                "rank": MEDALS.get(pos) or (int(pos) if pos.isdigit() else None),
                "tier": tier or None, "price": float(price) if price else None,
                "verdict": c.get("F", ""), "url": links.get(tab, {}).get(r),
            })
    return entries


def main(xlsx: str):
    entries = parse(xlsx)
    PARSED.write_text(json.dumps({"source": "RequIEM review ranking (.xlsx shared by the user)", "entries": entries},
                                 ensure_ascii=False, indent=1), encoding="utf-8")
    iems = json.loads((DATA / "iems.json").read_text(encoding="utf-8"))["iems"]
    hps = json.loads((DATA / "headphones.json").read_text(encoding="utf-8"))["iems"]
    merge = json.loads((DATA / "aliases.json").read_text(encoding="utf-8"))["merge"]
    comments, unmatched = requiem_comments(iems, hps, merge)
    put_comments(REVIEWER, comments)
    UNMATCHED.write_text("\n".join(sorted(set(unmatched))) + "\n", encoding="utf-8")
    print(f"{len(entries)} rows; {sum(len(v) for v in comments.values())} linked to {len(comments)} models; "
          f"{sum(1 for e in entries if e['url'])} with a Reddit review; {len(unmatched)} unmatched")


def requiem_comments(iems: list[dict], hps: list[dict], merge: dict[str, str]) -> tuple[dict, list[str]]:
    """IEM id -> RequIEM's comments (from data/requiem.json), plus the rows that found no model."""
    if not PARSED.exists():
        return {}, []
    entries = json.loads(PARSED.read_text(encoding="utf-8"))["entries"]
    aliases = json.loads(ALIASES.read_text(encoding="utf-8")) if ALIASES.exists() else {}
    link = make_linker(iems, hps, aliases)
    total = {k: sum(1 for e in entries if e["kind"] == k) for k in KINDS}
    comments, unmatched = defaultdict(list), []
    for e in entries:
        target = link(e["kind"], e["name"])
        if not target:
            unmatched.append(f"{e['kind']:10} {e['name']}")
            continue
        target = merge.get(target, target)
        out_of = total[e["kind"]]
        grade = " · ".join(x for x in (f"Tier {e['tier']}" if e["tier"] else "", f"#{e['rank']} of {out_of}" if e["rank"] else "") if x) or None
        comments[target].append({
            "reviewer": REVIEWER,
            "sourceType": "ranking-list",
            "grade": grade,
            "verdict": None,
            "quote": e["verdict"],
            "url": e["url"],
            "timestamp": None,
        })
    return comments, unmatched


if __name__ == "__main__":
    main(sys.argv[1])
