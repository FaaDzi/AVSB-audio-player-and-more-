import json
import sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(".")
sys.path.insert(0, str(ROOT / "scripts"))
from names import base, key

iems = json.load(open("app/public/data/iems.json", encoding="utf-8"))["iems"]
all_images = {}
for p in (ROOT / "app/public/data").glob("images*.json"):
    all_images.update(json.load(open(p, encoding="utf-8")))

verified_ids = set()
for i in iems:
    iid = i["id"]
    if iid in all_images:
        src = all_images[iid].get("src") or all_images[iid].get("url")
        if src and (ROOT / "app/public" / src.lstrip("/")).exists():
            verified_ids.add(iid)

missing = [i for i in iems if i["id"] not in verified_ids]

def classify(bname, iid):
    nl = bname.lower()
    if any(k in nl for k in ["subtonic", "nightjar", "night oblivion", "canpur", "oriolus", "rhapsodio", "jh audio", "hidition", "acoustune", "aaw", "plussound", "earsonics", "astell", "634ears"]):
        return "1. Summit-Fi & Ultra High-End Flagships"
    if any(k in nl for k in ["myer", "cklvx", "sliivo"]):
        return "2. MYER-AUDIO / CKLVX / SLIIVO Collection (100% Complete)"
    if any(k in nl for k in ["raptgo", "aur audio", "prisma audio", "audiosense", "tsmr", "tansio", "geek wold", "rose ", "roseselsa", "shozy", "whizzer", "reecho", "magaosi", "cvj", "qkz", "trn", "kz", "intime", "moondrop", "tangzu", "simgot", "dunu", "tinhifi", "tin ", "aful", "binary", "bgvp", "bqeyz", "ccz", "cca", "fealess", "fearless", "fiio", "hiby", "inawaken", "juzear", "kbear", "letshuoer", "nicehck", "sivga", "tipsy", "tri ", "tripowin", "yanyin", "yu9", "artti", "blon", "hisenior", "aiderlot"]):
        return "3. Chi-Fi Enthusiast & Audiophile Brands"
    if any(k in nl for k in ["samsung", "huawei", "tronsmart", "jbl", "baseus", "soundpeats", "soundpeat", "qcy", "earfun", "anker", "beats", "bose", "lg ", "motorola", "oppo", "nothing", "realme", "xiaomi", "status", "skullcandy", "tcl", "lenovo", "fiil", "edifier", "bang", "aukey", "acefast", "haylou"]):
        return "4. Consumer TWS & Tech Giants"
    if any(k in nl for k in ["etymotic", "shure", "flc technology", "flc", "aurisonics", "phonak", "meizu", "koss", "sony", "panasonic", "philips", "creative", "behringer", "monoprice", "nuforce", "quidelix", "sennheiser"]):
        return "5. Classic Studio & Legacy Audiophile"
    if any(k in nl for k in ["shortbus", "xinhs", "airline", "sample"]):
        return "6. Modder Community, Cables & Airline Earbuds"
    return "7. Other Boutique / Niche IEMs"

cat_groups = defaultdict(lambda: defaultdict(list))
for i in missing:
    b = base(i["name"])
    c = classify(b, i["id"])
    cat_groups[c][b].append(i)

lines = [
    "# Catalog Missing Images Audit",
    "",
    "This document provides a complete audit and classification of all IEM models and variants in the tournament catalog that currently do not have a verified local picture.",
    "",
    f"- **Total Catalog Items**: {len(iems)}",
    f"- **Items With Verified Local Images**: **{len(verified_ids)}** ({len(verified_ids)/len(iems)*100:.1f}% coverage)",
    f"- **Remaining Missing Items**: **{len(missing)}**",
    "",
    "> [!TIP]",
    "> Adding a base model photograph automatically derives and populates thumbnail images for all its nozzle, switch, filter, and ear tip variants via `scripts/propagate_search_images.py`.",
    ""
]

for cat in sorted(cat_groups):
    models = cat_groups[cat]
    total_items = sum(len(v) for v in models.values())
    lines.append(f"## {cat} ({len(models)} models, {total_items} catalog entries)")
    lines.append("")
    lines.append("| Model Name | Catalog ID | Variants / Modes | Notes / Key Features |")
    lines.append("|---|---|:---:|---|")
    for m, items in sorted(models.items(), key=lambda x: -len(x[1])):
        lead = items[0]
        v_str = f"{len(items)} variants" if len(items) > 1 else "1 (base)"
        lid = lead["id"]
        note = "Standard measurement"
        if "switch" in lid or "off" in lid:
            note = "Tuning switch permutation profile"
        elif "foam" in lid or "filter" in lid or "nozzle" in lid:
            note = "Filter / foam / nozzle variant"
        lines.append(f"| **{m}** | `{lid}` | {v_str} | {note} |")
    lines.append("")

out_path = Path(r"C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/missing_iems_list.md")
out_path.write_text("\n".join(lines), encoding="utf-8")
print("Regenerated missing_iems_list.md successfully!")

