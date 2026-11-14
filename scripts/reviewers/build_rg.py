"""Rikudou Goku's IEM Ranking tab (public Google Sheet linked as "Database" from rg.squig.link)
-> data/reviewers/rikudou-goku.json"""
import csv, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from resolve import resolve, clip, ROOT

SRC = "https://docs.google.com/spreadsheets/d/1YNuslYM4CrhMPrOLofzTm4ei7HEfP8AI1zxswrMw2ho/edit?gid=930033404"
rows = list(csv.DictReader(open(ROOT / "data/raw/reviewers/rikudou-goku/iem_ranking.csv", encoding="utf-8")))

entries = []
for r in rows:
    brand, model, note = r["Brand"].strip(), r["Model"].strip(), re.sub(r"\s+", " ", r["Notes"]).strip()
    if not model or not note:
        continue
    raw = f"{brand} {model}".strip()
    name, conf, _ = resolve(raw)
    grade = r["Ranking"].strip() or None
    v = f"Rikudou Goku ranks it {grade or 'without a tier'}"
    if r["Ranking (modded)"].strip():
        v += f" ({r['Ranking (modded)'].strip()} when modded" + (f" with {r['Mod'].strip()}" if r["Mod"].strip() else "") + ")"
    if r["Signature"].strip():
        v += f" and describes its signature as \"{r['Signature'].strip()}\""
    entries.append({"name": name, "rawName": raw, "nameConfidence": conf, "grade": grade, "verdict": v + ".",
                    "quote": clip(note), "quoteVerified": False, "url": SRC})

out = {"reviewer": "Rikudou Goku", "sourceType": "ranking-list", "sourceUrl": SRC, "accessed": "2026-10-16",
       "gradeScale": "Letter tiers from S+ (best) through A, B, C, D, E down to F, each with +/- steps; an optional second tier rates the IEM after his listed mod or EQ.",
       "entries": entries}
p = ROOT / "data/reviewers/rikudou-goku.json"
p.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print(len(entries), "entries")
