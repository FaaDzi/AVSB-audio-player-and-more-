"""Jay's Audio ear tip database (Google Sheet, Excel export) -> app/public/data/eartips_jay.json
plus each tip's photo and graph (vs KBEAR K07) as WebP in app/public/img/eartips/.

The sheet marks the chosen rating by colouring that word ("Poor/Normal/Great" with "Normal" in
orange), so ratings are read from the coloured run of each cell, not the plain text. Each tip is a
block: name row, ~10 rows holding two pictures (graph at column A, photo further right), then the
Tonality / Technical Performance / Build / Grip / Flexibility / Final Recommendation rows.

Tips Fernanda Gunsan also rates (app/public/data/eartips.json) are linked by FERNANDA below,
checked by hand: same product line and generation only.

Usage: python -I scripts/jay_eartips.py "<path to the .xlsx export>"
  export: https://docs.google.com/spreadsheets/d/1vNziv6_hnVKzkT8qq6FXhrsJM2zQWXkEHycuyFMnv8o/export?format=xlsx
"""
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "public" / "data" / "eartips_jay.json"
IMG = ROOT / "app" / "public" / "img" / "eartips"
SHEET_URL = "https://docs.google.com/spreadsheets/d/1vNziv6_hnVKzkT8qq6FXhrsJM2zQWXkEHycuyFMnv8o/htmlview"
KINDS = {"SILICONE TIPS": "silicone", "FOAM TIPS": "foam", "RANDOM STOCK TIPS": "stock"}  # "INCOMING" is skipped

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
EMBED = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
FIELDS = ["Tonality", "Technical Performance", "Build", "Grip Strength Rating", "Flexibility Rating", "Final Recommendation"]

# Jay's name -> Fernanda's (eartips.json). Left out on purpose: Xelastec (his is gen 1, Jay's is
# Xelastec 2), Sedna EarFit Short (original line vs Jay's Light Short), JVC Spiral Dot++ (Jay has the
# Spiral Dot Pro), Acoustune AET08 (Jay has the AET06).
FERNANDA = {
    "ACOUSTUNE AEX07": "Acoustune AEX07",
    "ACOUSTUNE AEX50": "Acoustune AEX50",
    "ACOUSTUNE AEX70": "Acoustune AEX70",
    "AZLA SEDNA LIGHT": "Azla Sedna Earfit Light",
    "DIVINUS VELVET REGULAR": "Divinus Velvet",
    "DUNU CANDY": "Dunu Candy",
    "DUNU S&S": "Dunu Stage & Studio",
    "FEAULLE H570": "Feaulle H570",
    "FINAL AUDIO E": "Final Audio Type E",
    "FINAL AUDIO FUSION-G": "Final Audio Fusion G",
    "PENTACONN COREIR BRASS": "Pentacon Coreir",  # he mentions its brass part
    "SOFTEARS ULTRACLEAR": "Softears UC",
    "SPINFIT CP145": "Spinfit CP145",
    "SPINFIT NEO": "Spinfit Neo",
    "SPINFIT W1": "Spinfit W1",
    "TANGZU SANCAI REGULAR": "Tangzu Sancai",
    "TRI CLARION": "Tri clarion",
}

# words kept as written in the shop names; everything else is Title-cased
UPPER = {"AZLA", "BGVP", "CCZ", "DUNU", "EPZ", "JVC", "KBEAR", "KZ", "TRI", "TRN", "ST35", "SE100", "S&S", "ZT01", "LT100", "TWS", "ASMR"}
SPECIAL = {"DDHIFI": "DDHiFi", "NICEHCK": "NiceHCK", "SOFTEARS": "Softears", "ULTRACLEAR": "UltraClear", "FUSION-G": "Fusion-G", "SOUNDCOCOON": "SoundCocoon"}


def pretty(name: str) -> str:
    def word(w: str) -> str:
        if w in SPECIAL:
            return SPECIAL[w]
        if w in UPPER or any(c.isdigit() for c in w):
            return w
        return "/".join(p.capitalize() for p in w.split("/"))
    return " ".join(word(w) for w in name.split())


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def rels(z: zipfile.ZipFile, path: str) -> dict:
    p = f"{os.path.dirname(path)}/_rels/{os.path.basename(path)}.rels"
    if p not in z.namelist():
        return {}
    return {e.get("Id"): e.get("Target") for e in ET.fromstring(z.read(p))}


def resolve(base: str, target: str) -> str:
    return os.path.normpath(os.path.join(os.path.dirname(base), target)).replace("\\", "/")


def shared_strings(z: zipfile.ZipFile) -> list:
    """Each shared string as [(text, coloured)] runs; coloured = a font colour other than the theme text."""
    out = []
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
        runs = []
        t = si.find("m:t", NS)
        if t is not None:
            runs.append((t.text or "", False))
        for r in si.findall("m:r", NS):
            c = r.find("m:rPr/m:color", NS)
            runs.append((r.find("m:t", NS).text or "", c is not None and c.get("rgb") not in (None, "FF000000")))
        out.append(runs)
    return out


def rating(field: dict | None) -> dict | None:
    """'Poor/Normal+/Great - note' with 'Normal+' coloured -> {rating: 'Normal+', note: 'note'}."""
    if not field:
        return None
    pick = next((h for h in field["hi"] if h.strip("/ ")), None)
    note = field["text"].split(" - ", 1)[1].strip() if " - " in field["text"] else ""
    return {"rating": pick.strip("/ -") if pick else None, "note": note}


TECH = re.compile(r"^\(?\s*(Improved|Reduced|No Change)\s*\)?\s*", re.I)


def tech(field: dict | None) -> dict | None:
    """'(Improved) better vocal detail' -> {rating: 'Improved', note: 'better vocal detail'}.
    The coloured run is the rating; a cell where only part of it is coloured falls back to the leading word."""
    if not field:
        return None
    m = TECH.match(field["text"])
    if m:
        return {"rating": m.group(1).title(), "note": field["text"][m.end():].strip(" -,")}
    pick = next((h for h in field["hi"] if h.strip()), "")
    word = pick.strip("() ") or None
    note = field["text"].replace(pick, "", 1).strip(" -,") if pick else field["text"]
    return {"rating": word, "note": note}


def save_webp(data: bytes, dest: Path, width: int, quality: int):
    im = Image.open(io.BytesIO(data)).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dest, "WEBP", quality=quality, method=6)


def main(xlsx: str):
    z = zipfile.ZipFile(xlsx)
    strings = shared_strings(z)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    wb_rels = rels(z, "xl/workbook.xml")
    IMG.mkdir(parents=True, exist_ok=True)
    tips = []
    for sh in wb.find("m:sheets", NS):
        kind = KINDS.get(sh.get("name"))
        if not kind:
            continue
        spath = resolve("xl/workbook.xml", wb_rels[sh.get(RID)])
        cells = {}
        for c in ET.fromstring(z.read(spath)).iter(f"{{{NS['m']}}}c"):
            m = re.match(r"([A-Z]+)(\d+)", c.get("r"))
            if c.get("t") == "s" and m.group(1) == "A":
                cells[int(m.group(2))] = strings[int(c.find("m:v", NS).text)]
        pics = []  # (row, col, media path)
        for target in rels(z, spath).values():
            if "drawing" not in target:
                continue
            dpath = resolve(spath, target)
            drels = rels(z, dpath)
            for anc in ET.fromstring(z.read(dpath)):
                fr, blip = anc.find("xdr:from", NS), anc.find(".//a:blip", NS)
                if fr is not None and blip is not None:
                    pics.append((int(fr.find("xdr:row", NS).text) + 1, int(fr.find("xdr:col", NS).text), resolve(dpath, drels[blip.get(EMBED)])))
        block = []
        for r in sorted(cells):
            text = re.sub(r"\s+", " ", "".join(t for t, _ in cells[r])).strip()
            f = re.match(r"(%s)\s*:\s*(.*)" % "|".join(map(re.escape, FIELDS)), text)
            if f and block:
                block[-1]["fields"][f.group(1)] = {"text": f.group(2).strip(), "hi": [t for t, h in cells[r] if h]}
            elif not f and r > 3 and text and len(text) < 80 and text.upper() == text:
                block.append({"raw": text, "row": r, "fields": {}})
        for i, b in enumerate(block):
            end = block[i + 1]["row"] if i + 1 < len(block) else 10**9
            mine = sorted((p for p in pics if b["row"] <= p[0] < end), key=lambda p: p[1])
            f = b["fields"]
            if not f:
                continue
            name = pretty(b["raw"])
            sid = slug(name)
            tip = {
                "id": sid,
                "name": name,
                "kind": kind,
                "tonality": f.get("Tonality", {}).get("text", ""),
                "tech": tech(f.get("Technical Performance")),
                "build": f.get("Build", {}).get("text", ""),
                "grip": rating(f.get("Grip Strength Rating")),
                "flex": rating(f.get("Flexibility Rating")),
                "verdict": f.get("Final Recommendation", {}).get("text", ""),
                "photo": None,
                "graph": None,
            }
            # the graph sits at column A, the photo to its right
            for _, col, media in mine:
                key = "graph" if col == 0 else "photo"
                if tip[key]:
                    continue
                dest = IMG / f"{sid}{'-graph' if key == 'graph' else ''}.webp"
                save_webp(z.read(media), dest, 720 if key == "graph" else 192, 72 if key == "graph" else 80)
                tip[key] = f"img/eartips/{dest.name}"
            if b["raw"] in FERNANDA:
                tip["fernanda"] = FERNANDA[b["raw"]]
            tips.append(tip)
    linked = {t.get("fernanda") for t in tips} - {None}
    missing = set(FERNANDA.values()) - linked
    if missing:
        sys.exit(f"Fernanda links not found in the sheet: {sorted(missing)}")
    OUT.write_text(
        json.dumps(
            {
                "reviewer": "Jay's Audio",
                "url": SHEET_URL,
                "baseline": "KBEAR K07",
                "note": "Every tip is graphed on the same IEM against KBEAR K07, the most common tip.",
                "tips": tips,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    size = sum(p.stat().st_size for p in IMG.glob("*.webp")) / 1e6
    print(f"{len(tips)} tips ({len(linked)} also rated by Fernanda) -> {OUT.name}; images {size:.1f} MB")
    for t in tips:
        if not (t["grip"] and t["grip"]["rating"] and t["flex"] and t["flex"]["rating"] and t["tech"] and t["tech"]["rating"]):
            print("  incomplete rating:", t["name"], t["grip"], t["flex"], t["tech"] and t["tech"]["rating"])


if __name__ == "__main__":
    main(sys.argv[1])
