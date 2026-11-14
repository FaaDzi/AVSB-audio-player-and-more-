"""Crinacle's IEM Ranking List (crinacle.com/rankings/iems/)
-> data/reviewers/crinacle.json"""
import json, re, html, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "scripts" / "reviewers"))
from resolve import resolve, clip
from parse_crinacle_rankings import parsed

SRC = "https://crinacle.com/rankings/iems/"
ALIASES = json.load(open(ROOT / "data" / "jay_aliases.json", encoding="utf-8")) if (ROOT / "data" / "jay_aliases.json").exists() else {}

entries = []
for p in parsed:
    cells = p["cells"]
    if len(cells) < 8:
        continue
    rank = cells[0].strip()
    val_stars = cells[1].strip()
    raw_model = cells[2].strip()
    price = cells[3].strip()
    signature = cells[4].strip()
    comment = cells[5].strip()
    tone = cells[6].strip()
    tech = cells[7].strip()
    
    if not comment or comment in ("—", "-", "N/A"):
        continue

    # Clean model for resolver
    clean_model = re.sub(r'\s*\(\d{4}\)', '', raw_model)
    clean_model = re.sub(r'\bA/U', 'U', clean_model)
    
    if raw_model in ALIASES:
        name, conf, in_cat = ALIASES[raw_model], "high", True
    elif clean_model in ALIASES:
        name, conf, in_cat = ALIASES[clean_model], "high", True
    else:
        name, conf, in_cat = resolve(clean_model)
        if conf == "low":
            name2, conf2, in_cat2 = resolve(raw_model)
            if conf2 != "low":
                name, conf, in_cat = name2, conf2, in_cat2

    verdict_parts = [f"Crinacle ranks it {rank}"]
    details = []
    if tone: details.append(f"tone {tone}")
    if tech: details.append(f"technicalities {tech}")
    if val_stars: details.append(f"{val_stars} value")
    if details:
        verdict_parts.append(f"({', '.join(details)})")
    if signature:
        verdict_parts.append(f"with a {signature.lower()} signature")
    if price and price != "0":
        verdict_parts.append(f"(MSRP ${price})")

    verdict = " ".join(verdict_parts) + "."

    entries.append({
        "name": name,
        "rawName": raw_model,
        "nameConfidence": conf,
        "grade": rank if rank else None,
        "verdict": verdict,
        "quote": clip(html.unescape(comment)),
        "quoteVerified": True,
        "url": SRC,
    })

out = {
    "reviewer": "Crinacle",
    "sourceType": "ranking-list",
    "sourceUrl": SRC,
    "accessed": "2026-10-21",
    "gradeScale": "Letter grades from S+ down to F; separate grades for Tone and Technical performance; value stars up to 3 stars.",
    "entries": entries,
}

out_path = ROOT / "data" / "reviewers" / "crinacle.json"
out_path.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {len(entries)} Crinacle entries ({sum(1 for e in entries if e['nameConfidence'] == 'high')} high confidence) to {out_path}")
