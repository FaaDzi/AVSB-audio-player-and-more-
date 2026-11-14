"""Parse Jay Audio's (@jayyaudio) IEM ranking sheet (PDF export) into data/jay_rankings.json.

Rows are split on the sheet's own horizontal grid lines and words are assigned to
columns by x position, so multi-line cells stay together.

Usage: .venv/Scripts/python -I scripts/parse_jay.py "<path to PDF>"
"""
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "jay_rankings.json"

# Column left edges from the sheet's vertical grid lines (identical on every page).
EDGES = [50, 71, 81.5, 95, 139, 153, 167, 193]
COLS = ["volume", "rank", "score", "iem", "tuning", "tech", "value", "notes"]
HEADER_Y = 72  # page 1 legend + header rows end here
FLAGS = {"💎": "totl", "💖": "fav"}  # 💎 💖
STAR = "🌟"  # 🌟 value rank, up to 3


def row_lines(page, x_lo, x_hi):
    ys = set()
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 0.5:
                a, b = sorted((it[1].x, it[2].x))
                if a <= x_lo + 1 and b >= x_hi - 1:
                    ys.add(round(it[1].y, 1))
            elif it[0] == "re":
                r = it[1]
                if r.x0 <= x_lo + 1 and r.x1 >= x_hi - 1:
                    ys.update((round(r.y0, 1), round(r.y1, 1)))
    out = []
    for y in sorted(ys):
        if not out or y - out[-1] > 1.5:
            out.append(y)
    return out


def col_of(x, edges):
    i = 0
    for k, e in enumerate(edges):
        if x >= e:
            i = k
    return i


def join(ws):
    ws = sorted(ws, key=lambda w: (round(w[1] / 2), w[0]))
    return re.sub(r"\s+", " ", " ".join(w[4] for w in ws)).strip()


def parse_row(cells):
    iem = cells["iem"]
    rank = cells["rank"] or None
    notes = cells["notes"]
    if rank == "Re-listen" and " - " in iem:  # merged "Name - note" cells spill over every column
        spill = " ".join(cells[c] for c in ("tuning", "tech", "value", "notes") if cells[c])
        iem, notes = iem.split(" - ", 1)
        notes = f"{notes} {spill}".strip()
        cells = {**cells, "tuning": "", "tech": "", "value": ""}
    flags = sorted({f for e, f in FLAGS.items() if e in iem})
    stars = iem.count(STAR)
    for e in list(FLAGS) + [STAR]:
        iem = iem.replace(e, "")
    price = re.search(r"\(\$\s?([\d,]+)\)", iem) or re.search(r"\$\s?([\d,]+)", iem)
    name = re.sub(r"\(.*?\)|\$\s?[\d,]+", "", iem)
    name = re.sub(r"\b(disc\.?|Disc\.?|NEW unit|Asia Only|outdated dont buy|with AZLA tips\.?)(?=\s|$)", "", name)
    not_rec = bool(re.search(r"\bnot rec\b", name, re.I))
    name = re.sub(r"\bnot rec\b", "", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not_rec:
        flags = sorted(set(flags) | {"notRecommended"})
    score = re.search(r"\d+(?:\.\d)?", cells["score"])
    return {
        "name": name,
        "rawName": iem.strip(),
        "priceUsd": int(price.group(1).replace(",", "")) if price else None,
        "discontinued": bool(re.search(r"\bdisc\b", iem, re.I)),
        "rank": rank,
        "score": float(score.group(0)) if score else None,
        "tuning": cells["tuning"] or None,
        "tech": cells["tech"] or None,
        "value": cells["value"] or None,
        "valueStars": stars,
        "flags": flags,
        "volume": cells["volume"].replace("(", "").replace(")", "") or None,
        "notes": notes,
    }


def main(pdf):
    doc = fitz.open(pdf)
    rows, section = [], None
    for pno, page in enumerate(doc):
        words = page.get_text("words")
        lines = row_lines(page, EDGES[3], EDGES[4] - 1)
        for y0, y1 in zip(lines, lines[1:]):
            if pno == 0 and y1 <= HEADER_Y:
                continue
            cells = {c: [] for c in COLS}
            for w in words:
                cy = (w[1] + w[3]) / 2
                if y0 <= cy < y1:
                    cells[COLS[col_of((w[0] + w[2]) / 2, EDGES)]].append(w)
            text = {c: join(ws) for c, ws in cells.items()}
            joined = " ".join(text[c] for c in COLS if text[c])
            if "Pink hilighted" in joined or text["iem"] == "IEM" or text["rank"] == "Rank":
                continue  # legend / header repeated at the top of each page
            if not any(text[c] for c in ("score", "tuning", "tech", "notes")) and "$" not in text["iem"]:
                if joined and joined.upper() == joined:
                    section = joined  # tier heading row (ENDGAME, GREAT (POTENTIAL ENDGAME), ...)
                continue
            if not text["iem"]:
                continue
            r = parse_row(text)
            if r["name"].upper() == r["name"] and r["priceUsd"] is None and r["score"] is None:
                continue  # stray tier word that landed in the IEM column
            r["tier"] = section
            r["page"] = pno + 1
            rows.append(r)

    OUT.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(rows)} rows -> {OUT}")
    print(f"with price: {sum(r['priceUsd'] is not None for r in rows)}, with score: {sum(r['score'] is not None for r in rows)}")


if __name__ == "__main__":
    main(sys.argv[1])
