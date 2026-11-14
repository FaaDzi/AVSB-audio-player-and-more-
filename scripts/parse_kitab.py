"""Parse Fernanda Gunsan's "Kitab Audio" (Google Sheet export, Indonesian) into data/kitab.json.

Tabs read: TWS, TWS NO KARET, OWS (open-ear), IEM, W. Headphone (wireless), Headphone, Gaming,
Eartips. Each row keeps his grades and scores verbatim and the review in the original language;
English translations live in data/kitab_en.json (keyed by entry id) and are merged by
scripts/build_reviews.py. Tier cells are merged across rows in the sheet, so merged ranges are
filled down before reading.

Usage: .venv/Scripts/python.exe -I scripts/parse_kitab.py data/raw/kitab/<export>.xlsx
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "kitab.json"

# tab -> device kind in the app
TABS = {"TWS": "tws", "TWS NO KARET": "tws", "OWS": "tws", "IEM": "iem", "W. Headphone": "headphone-wireless",
        "Headphone": "headphone", "Gaming": "headphone-gaming"}
# header text (lowercased, first line) -> field
FIELDS = {
    "tier": "tier", "sound": "tier", "rank": "tier", "value": "value", "iem": "name", "tws": "name", "headphone": "name",
    "review": "review", "price": "price", "harga": "price", "link": "price", "driver": "driver", "type": "type",
    "kabel": "cable", "bias preferensi": "bias", "musician": "fit", "total": "total", "overall": "total",
    "bass": "bass", "lo mid": "loMid", "hi mid": "hiMid", "treble": "treble", "voc": "vocal", "vocal": "vocal",
    "sibilance": "sibilance", "soundstage": "soundstage", "imaging": "imaging", "instrument": "separation",
    "separation": "separation", "timbre": "timbre", "punch": "punch", "detail": "detail", "technicality": "technicality",
    "eartips yg cocok": "tips", "kabel recommend": "cableRec", "parametric eq": "eq", "needs": "needs",
    "bluetooth": "codec", "anc": "anc", "mic test": "mic", "earpads": "pads", "fitting": "fitting", "tuning": "tuning",
    "volume": "volume",
}


def filled_rows(ws):
    grid = [list(r) for r in ws.iter_rows(values_only=True)]
    for rng in ws.merged_cells.ranges:
        v = grid[rng.min_row - 1][rng.min_col - 1]
        for r in range(rng.min_row - 1, rng.max_row):
            for c in range(rng.min_col - 1, rng.max_col):
                if r < len(grid) and c < len(grid[r]):
                    grid[r][c] = v
    return grid


def header_map(rows):
    """Column -> field from the header row (and the sub-header row under it, for score columns)."""
    hi = next(i for i, r in enumerate(rows[:6]) if any(isinstance(v, str) and v.strip().lower() == "review" for v in r))
    cols = {}
    for r in (rows[hi], rows[hi + 1] if hi + 1 < len(rows) else []):
        for c, v in enumerate(r):
            if not isinstance(v, str):
                continue
            h = v.strip().split("\n")[0].strip().lower()
            for k, f in FIELDS.items():
                if h == k or h.startswith(k + " ") or h.startswith(k + "/"):
                    cols.setdefault(c, f)
                    break
    return hi, cols


def clean(v):
    if v is None:
        return None
    if isinstance(v, float):
        return round(v, 2) if v != int(v) else int(v)
    s = str(v).strip()
    return s or None


def parse_tab(ws, kind):
    rows = filled_rows(ws)
    hi, cols = header_map(rows)
    out = []
    for r in rows[hi + 1:]:
        e = {}
        for c, f in cols.items():
            if c < len(r) and (v := clean(r[c])) is not None and f not in e:
                e[f] = v
        name_cell = e.get("name")
        if not isinstance(name_cell, str) or not isinstance(e.get("review"), str) or len(e["review"]) < 15:
            continue
        lines = [x.strip() for x in name_cell.split("\n") if x.strip()]
        e["name"], e["tagline"] = lines[0], " ".join(lines[1:]) or None
        if isinstance(e.get("price"), (int, float)):
            e["priceIdr"] = e.pop("price")
        else:
            e.pop("price", None)
        e["kind"] = kind
        out.append(e)
    return out


def parse_eartips(ws):
    rows = filled_rows(ws)
    hi = next(i for i, r in enumerate(rows[:6]) if any(isinstance(v, str) and v.strip().lower() == "eartips" for v in r))
    head = [str(v or "").strip().lower() for v in rows[hi]]
    col = lambda name: head.index(name) if name in head else None
    c_rank, c_name, c_use, c_char, c_used = col("rank"), col("eartips"), col("dipakai di"), col("karakter"), col("pernah dipakai di")
    notes = [clean(v) for v in rows[0] if clean(v)]
    out = []
    for r in rows[hi + 1:]:
        name = clean(r[c_name]) if c_name is not None else None
        char = clean(r[c_char]) if c_char is not None else None
        if not isinstance(name, str) or not isinstance(char, str):
            continue
        lines = [x.strip() for x in name.split("\n") if x.strip()]
        out.append({"name": lines[0], "tagline": " ".join(lines[1:]) or None, "tier": clean(r[c_rank]) if c_rank is not None else None,
                    "useOn": clean(r[c_use]) if c_use is not None else None, "review": char,
                    "usedWith": clean(r[c_used]) if c_used is not None else None, "kind": "eartips"})
    return out, notes


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    entries = []
    for tab, kind in TABS.items():
        got = parse_tab(wb[tab], kind)
        print(f"{tab:14} {len(got)} entries")
        entries += got
    tips, tip_notes = parse_eartips(wb["Eartips"])
    print(f"{'Eartips':14} {len(tips)} entries")
    entries += tips
    ids = set()
    for e in entries:
        i = f"{e['kind']}-{slug(e['name'])}"
        while i in ids:
            i += "-2"
        ids.add(i)
        e["id"] = i
    # rows he has since taken off the sheet keep their last review (owner, 2026-11-13: "don't remove the old reviews")
    if OUT.exists():
        kept = [dict(e, offSheet=True) for e in json.loads(OUT.read_text(encoding="utf-8"))["entries"] if e["id"] not in ids]
        print(f"{'kept, off sheet':14} {len(kept)} entries")
        entries += kept
    m = re.search(r"\d{4}-\d{2}-\d{2}", Path(sys.argv[1]).name)
    OUT.write_text(json.dumps({
        "source": f"Fernanda Gunsan, Kitab Audio (Google Sheet, export of {m.group(0) if m else 'unknown date'}). Indonesian; reviews are his subjective opinion.",
        "credit": {"instagram": "https://www.instagram.com/fernandagunsan", "tiktok": "https://www.tiktok.com/@fernandagunsan"},
        "eartipNotes": tip_notes,
        "entries": entries,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(entries)} entries -> {OUT}")


if __name__ == "__main__":
    main()
