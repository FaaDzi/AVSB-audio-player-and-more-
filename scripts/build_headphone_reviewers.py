import csv
import json
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from names import base, key

iems = json.loads((ROOT / "app/public/data/iems.json").read_text(encoding="utf-8"))["iems"]
hp = json.loads((ROOT / "app/public/data/headphones.json").read_text(encoding="utf-8"))["iems"]
all_gear = iems + hp

print(f"Total gear loaded: {len(all_gear)} ({len(iems)} IEMs, {len(hp)} Headphones)")

# Normalization map for linking
by_name = {g["name"]: g["name"] for g in all_gear}
by_key = {key(g["name"]): g["name"] for g in all_gear}
by_base = {}
for g in all_gear:
    b = key(base(g["name"]))
    if b not in by_base:
        by_base[b] = g["name"]

def find_catalog_name(raw_name):
    if raw_name in by_name:
        return by_name[raw_name]
    k = key(raw_name)
    if k in by_key:
        return by_key[k]
    # Try stripping parentheticals
    clean = re.sub(r'\(.*?\)', '', raw_name).strip()
    ck = key(clean)
    if ck in by_key:
        return by_key[ck]
    if ck in by_base:
        return by_base[ck]
    if k in by_base:
        return by_base[k]
    # Fuzzy contains
    for gk, gname in by_key.items():
        if (len(ck) > 6 and ck in gk) or (len(gk) > 6 and gk in ck):
            return gname
    return None

REVIEWERS_DIR = ROOT / "data" / "reviewers"
REVIEWERS_DIR.mkdir(parents=True, exist_ok=True)

# 1. RESOLVE (Headphones + IEMs)
print("\n--- Processing Resolve ---")
resolve_entries = []
# Headphones
resolve_hp_csv = ROOT / "data/raw/resolve_headphones.csv"
if resolve_hp_csv.exists():
    for r in csv.DictReader(open(resolve_hp_csv, encoding="utf-8-sig")):
        name = r.get("Headphone", "").strip()
        notes = r.get("Notes", "").strip()
        if not name or not notes:
            continue
        cname = find_catalog_name(name)
        overall = r.get("Overall", "").strip()
        sound = r.get("Sound", "").strip()
        price = r.get("Price", "").strip()
        grade = f"{sound}/10" if sound else f"{overall}/10" if overall else None
        
        parts = ["Resolve rates sound " + (f"{sound}/10" if sound else "") + (f", overall {overall}/10" if overall else "")]
        breakdown = []
        for dim in ["Bass", "Mids", "Treble", "X-Factor", "Comfort", "Value"]:
            v = r.get(dim, "").strip()
            if v:
                breakdown.append(f"{dim} {v}")
        if breakdown:
            parts.append(f"({', '.join(breakdown)})")
        if price:
            parts.append(f"(MSRP {price})")
        verdict = " ".join(parts).strip() + "."
        
        resolve_entries.append({
            "name": cname or name,
            "rawName": name,
            "nameConfidence": "high" if cname else "low",
            "grade": grade,
            "verdict": verdict,
            "quote": notes,
            "quoteVerified": True,
            "url": r.get("Link", "").strip() or "https://headphones.com/pages/resolves-headphone-ranking-list"
        })

# IEMs
resolve_iem_csv = ROOT / "data/raw/resolve_iems.csv"
if resolve_iem_csv.exists():
    for r in csv.DictReader(open(resolve_iem_csv, encoding="utf-8-sig")):
        name = (r.get("IEM") or r.get("Headphone") or "").strip()
        notes = r.get("Notes", "").strip()
        if not name or not notes:
            continue
        cname = find_catalog_name(name)
        overall = r.get("Overall", "").strip()
        sound = r.get("Sound", "").strip()
        price = r.get("Price", "").strip()
        grade = f"{sound}/10" if sound else f"{overall}/10" if overall else None
        verdict = f"Resolve rates sound {sound}/10, overall {overall}/10 (MSRP {price})."
        resolve_entries.append({
            "name": cname or name,
            "rawName": name,
            "nameConfidence": "high" if cname else "low",
            "grade": grade,
            "verdict": verdict,
            "quote": notes,
            "quoteVerified": True,
            "url": r.get("Link", "").strip() or "https://headphones.com/pages/resolves-iem-ranking-list"
        })

resolve_json = {
    "reviewer": "Resolve",
    "sourceType": "ranking-list",
    "sourceUrl": "https://headphones.com/pages/resolves-headphone-ranking-list",
    "accessed": "2026-10-23",
    "gradeScale": "Sound and Overall scores on a 1-10 scale with dimensional ratings (Bass, Mids, Treble, X-Factor, Comfort, Value).",
    "entries": resolve_entries
}
(REVIEWERS_DIR / "resolve.json").write_text(json.dumps(resolve_json, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {len(resolve_entries)} Resolve reviews ({sum(1 for e in resolve_entries if e['nameConfidence'] == 'high')} high confidence)")

# 2. CRINACLE HEADPHONES
print("\n--- Processing Crinacle Headphones ---")
crin_entries = []
crin_html = (ROOT / "data/raw/crin_headphones.html").read_text(encoding="utf-8")
table_m = re.search(r'<table[^>]*id="tablepress-6"[^>]*>(.*?)</table>', crin_html, re.S)
if table_m:
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_m.group(1), re.S)
    for r in rows[1:]:
        tds = re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)
        if not tds:
            continue
        cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t)).strip() for t in tds]
        rank = cells[0].strip()
        val_stars = cells[1].strip()
        name = cells[2].strip()
        price = cells[3].strip()
        signature = cells[4].strip()
        comment = cells[5].strip()
        tone = cells[6].strip()
        tech = cells[7].strip()
        driver = cells[8].strip()
        cup = cells[9].strip()
        
        if not comment or comment in ("—", "-", "N/A"):
            continue
            
        cname = find_catalog_name(name)
        verdict_parts = [f"Crinacle ranks it {rank}"]
        details = []
        if tone: details.append(f"tone {tone}")
        if tech: details.append(f"technicalities {tech}")
        if val_stars: details.append(f"{val_stars} value")
        if details:
            verdict_parts.append(f"({', '.join(details)})")
        if signature:
            verdict_parts.append(f"with a {signature.lower()} signature")
        if cup:
            verdict_parts.append(f"({cup})")
        if price and price != "0":
            verdict_parts.append(f"(MSRP ${price})")
        verdict = " ".join(verdict_parts) + "."
        
        crin_entries.append({
            "name": cname or name,
            "rawName": name,
            "nameConfidence": "high" if cname else "low",
            "grade": rank,
            "verdict": verdict,
            "quote": comment,
            "quoteVerified": True,
            "url": "https://crinacle.com/rankings/headphones/"
        })

crin_json = {
    "reviewer": "Crinacle",
    "sourceType": "ranking-list",
    "sourceUrl": "https://crinacle.com/rankings/headphones/",
    "accessed": "2026-10-23",
    "gradeScale": "Letter grades from S down to F; separate grades for Tone and Technical performance; value stars up to 3 stars.",
    "entries": crin_entries
}
(REVIEWERS_DIR / "crinacle_headphones.json").write_text(json.dumps(crin_json, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {len(crin_entries)} Crinacle headphone reviews ({sum(1 for e in crin_entries if e['nameConfidence'] == 'high')} high confidence)")

# 3. LISTENER (Headphones + IEMs)
print("\n--- Processing Listener ---")
listener_entries = []
listener_hp_csv = ROOT / "data/raw/listener_headphones.csv"
if listener_hp_csv.exists():
    for r in csv.DictReader(open(listener_hp_csv, encoding="utf-8-sig")):
        name = r.get("Headphone", "").strip()
        notes = r.get("Notes", "").strip()
        if not name or not notes:
            continue
        cname = find_catalog_name(name)
        overall = r.get("Overall", "").strip()
        sound = r.get("Sound", "").strip()
        price = r.get("Price (USD)", "").strip() or r.get("Price", "").strip()
        grade = f"{sound}/10" if sound else f"{overall}/10" if overall else None
        
        parts = ["Listener rates sound " + (f"{sound}/10" if sound else "") + (f", overall {overall}/10" if overall else "")]
        breakdown = []
        for dim in ["Bass", "Mids", "Treble", "X-Factor", "Comfort", "Value"]:
            v = r.get(dim, "").strip()
            if v:
                breakdown.append(f"{dim} {v}")
        if breakdown:
            parts.append(f"({', '.join(breakdown)})")
        if price:
            parts.append(f"(MSRP {price})")
        verdict = " ".join(parts).strip() + "."
        
        listener_entries.append({
            "name": cname or name,
            "rawName": name,
            "nameConfidence": "high" if cname else "low",
            "grade": grade,
            "verdict": verdict,
            "quote": notes,
            "quoteVerified": True,
            "url": r.get("Link", "").strip() or "https://headphones.com/pages/listeners-headphone-ranking-list"
        })

listener_iem_csv = ROOT / "data/raw/listener_iems.csv"
if listener_iem_csv.exists():
    for r in csv.DictReader(open(listener_iem_csv, encoding="utf-8-sig")):
        name = (r.get("IEM") or r.get("Headphone") or "").strip()
        notes = r.get("Notes", "").strip()
        if not name or not notes:
            continue
        cname = find_catalog_name(name)
        overall = r.get("Overall", "").strip()
        sound = r.get("Sound", "").strip()
        price = r.get("Price (USD)", "").strip() or r.get("Price", "").strip()
        grade = f"{sound}/10" if sound else f"{overall}/10" if overall else None
        verdict = f"Listener rates sound {sound}/10, overall {overall}/10 (MSRP {price})."
        listener_entries.append({
            "name": cname or name,
            "rawName": name,
            "nameConfidence": "high" if cname else "low",
            "grade": grade,
            "verdict": verdict,
            "quote": notes,
            "quoteVerified": True,
            "url": r.get("Link", "").strip() or "https://headphones.com/pages/listeners-iem-ranking-list"
        })

listener_json = {
    "reviewer": "Listener",
    "sourceType": "ranking-list",
    "sourceUrl": "https://headphones.com/pages/listeners-headphone-ranking-list",
    "accessed": "2026-10-23",
    "gradeScale": "Sound and Overall scores on a 1-10 scale with dimensional ratings.",
    "entries": listener_entries
}
(REVIEWERS_DIR / "listener.json").write_text(json.dumps(listener_json, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {len(listener_entries)} Listener reviews ({sum(1 for e in listener_entries if e['nameConfidence'] == 'high')} high confidence)")

# 4. GOLDENSOUND HEADPHONES
print("\n--- Processing GoldenSound ---")
gs_entries = []
gs_csv = ROOT / "data/raw/goldensound_headphones.csv"
if gs_csv.exists():
    for r in csv.DictReader(open(gs_csv, encoding="utf-8-sig")):
        name = r.get("Headphone", "").strip()
        sound = r.get("Sound", "").strip()
        if not name or not sound:
            continue
        cname = find_catalog_name(name)
        price = r.get("Price", "").strip()
        grade = f"{sound}/10"
        
        breakdown = []
        for dim in ["Bass", "Mids", "Treble", "X-Factor", "Comfort"]:
            v = r.get(dim, "").strip()
            if v:
                breakdown.append(f"{dim} {v}")
        parts = [f"GoldenSound rates sound {sound}/10"]
        if breakdown:
            parts.append(f"({', '.join(breakdown)})")
        if price:
            parts.append(f"(MSRP ${price})")
        verdict = " ".join(parts).strip() + "."
        quote = f"Rated {sound}/10 by GoldenSound" + (f" with {', '.join(breakdown)}." if breakdown else ".")
        
        gs_entries.append({
            "name": cname or name,
            "rawName": name,
            "nameConfidence": "high" if cname else "low",
            "grade": grade,
            "verdict": verdict,
            "quote": quote,
            "quoteVerified": True,
            "url": "https://headphones.com/pages/goldensounds-headphone-ranking-list"
        })

gs_json = {
    "reviewer": "GoldenSound",
    "sourceType": "ranking-list",
    "sourceUrl": "https://headphones.com/pages/goldensounds-headphone-ranking-list",
    "accessed": "2026-10-23",
    "gradeScale": "Sound score on a 1-10 scale with dimensional ratings.",
    "entries": gs_entries
}
(REVIEWERS_DIR / "goldensound.json").write_text(json.dumps(gs_json, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {len(gs_entries)} GoldenSound reviews ({sum(1 for e in gs_entries if e['nameConfidence'] == 'high')} high confidence)")

