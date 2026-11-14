"""Parse Jay Audio's (@jayyaudio) IEM ranking sheet from its Excel export into data/jay_rankings.json.

Preferred over scripts/parse_jay.py (PDF): one row per IEM with clean cells, plus the
sheet's shop links and the pink highlight ("closer to my preference").
Output rows have the same fields as the PDF parser, plus `pink`, `fill` and `link`.

Usage: python -I scripts/parse_jay_xlsx.py "<path to Jay's IEM Ranking List.xlsx>"
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
from parse_jay import parse_row  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "jay_rankings.json"
COLS = ["volume", "rank", "score", "iem", "tuning", "tech", "value", "notes"]  # A..H
HEADER_ROW = 5
PINK = {"FFF3DBDB", "FFEA9999"}  # the sheet's "closer to my preference" highlights


def text(v) -> str:
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""


def main(path):
    ws = openpyxl.load_workbook(path).active
    rows, section = [], None
    for r in range(HEADER_ROW + 1, ws.max_row + 1):
        cells = {c: text(ws.cell(r, i + 1).value) for i, c in enumerate(COLS)}
        if not any(cells.values()):
            continue
        if cells["iem"] == "IEM" or cells["rank"] == "Rank":
            continue
        if not cells["iem"]:
            heading = " ".join(v for v in cells.values() if v)
            if heading.upper() == heading:
                section = heading  # tier heading row (PERFECTION?, ENDGAME, ...)
            continue
        row = parse_row(cells)
        if not row["name"]:
            continue
        iem_cell = ws.cell(r, 4)
        fill = iem_cell.fill.fgColor.rgb if iem_cell.fill and iem_cell.fill.fgColor else None
        link = next((ws.cell(r, c).hyperlink.target for c in range(1, 9) if ws.cell(r, c).hyperlink), None)
        row.update({"tier": section, "row": r, "pink": fill in PINK, "fill": fill if isinstance(fill, str) else None, "link": link})
        rows.append(row)

    OUT.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(rows)} rows -> {OUT}")
    print(f"price {sum(r['priceUsd'] is not None for r in rows)}, score {sum(r['score'] is not None for r in rows)}, "
          f"pink {sum(r['pink'] for r in rows)}, links {sum(bool(r['link']) for r in rows)}, "
          f"tiers {len({r['tier'] for r in rows})}")


if __name__ == "__main__":
    main(sys.argv[1])
