import json
from pathlib import Path
from collections import defaultdict
import sys

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

sys.stdout.reconfigure(encoding="utf-8")

# Let's write a detailed classification script
def classify(bname, iid):
    nl = bname.lower()
    il = iid.lower()
    
    # Summit-fi / High end
    if any(k in nl for k in ["subtonic", "nightjar", "night oblivion", "canpur", "oriolus", "rhapsodio", "jh audio", "hidition", "acoustune", "aaw", "plussound", "earsonics", "astell", "634ears"]):
        return "1. Summit-Fi & Ultra High-End Flagships"
    
    # Myer / CKLVX / Sliivo
    if any(k in nl for k in ["myer", "cklvx", "sliivo"]):
        return "2. MYER-AUDIO / CKLVX / SLIIVO Collection"
        
    # Popular Chi-Fi
    if any(k in nl for k in ["raptgo", "aur audio", "prisma audio", "audiosense", "tsmr", "tansio", "geek wold", "rose ", "roseselsa", "shozy", "whizzer", "reecho", "magaosi", "cvj", "qkz", "trn", "kz", "intime", "moondrop", "tangzu", "simgot", "dunu", "tinhifi", "tin ", "aful", "binary", "bgvp", "bqeyz", "ccz", "cca", "fealess", "fearless", "fiio", "hiby", "inawaken", "juzear", "kbear", "letshuoer", "nicehck", "sivga", "tipsy", "tri ", "tripowin", "yanyin", "yu9", "artti", "blon", "hisenior", "aiderlot"]):
        return "3. Chi-Fi Enthusiast & Audiophile Brands"
        
    # TWS & Consumer tech
    if any(k in nl for k in ["samsung", "huawei", "tronsmart", "jbl", "baseus", "soundpeats", "soundpeat", "qcy", "earfun", "anker", "beats", "bose", "lg ", "motorola", "oppo", "nothing", "realme", "xiaomi", "status", "skullcandy", "tcl", "lenovo", "fiil", "edifier", "bang", "aukey", "acefast", "haylou"]):
        return "4. Consumer TWS & Tech Giants"
        
    # Classic / Legacy
    if any(k in nl for k in ["etymotic", "shure", "flc technology", "flc", "aurisonics", "phonak", "meizu", "koss", "sony", "panasonic", "philips", "creative", "behringer", "monoprice", "nuforce", "quidelix", "sennheiser"]):
        return "5. Classic Studio & Legacy Audiophile"
        
    # Modder / Boutique / Niche
    if any(k in nl for k in ["shortbus", "xinhs", "airline", "sample"]):
        return "6. Modder Community, Cables & Airline Earbuds"
        
    return "7. Other Boutique / Niche IEMs"

cat_groups = defaultdict(lambda: defaultdict(list))
for i in missing:
    b = base(i["name"])
    c = classify(b, i["id"])
    cat_groups[c][b].append(i)

for cat in sorted(cat_groups):
    models = cat_groups[cat]
    total_items = sum(len(v) for v in models.values())
    print(f"\n=======================================================")
    print(f"{cat} ({len(models)} models, {total_items} catalog items)")
    print(f"=======================================================")
    for m, items in sorted(models.items(), key=lambda x: -len(x[1])):
        sample_id = items[0]["id"]
        var_text = f" ({len(items)} variants)" if len(items) > 1 else ""
        print(f"  • {m}{var_text} -> `{sample_id}`")

