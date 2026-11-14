import json
from pathlib import Path

ROOT = Path(".")
search_file = ROOT / "app/public/data/images_search.json"
search_data = json.load(open(search_file, encoding="utf-8"))
iems = json.load(open(ROOT / "app/public/data/iems.json", encoding="utf-8"))["iems"]

storm_img = "img/iem/subtonic-storm.webp"
d62_img = "img/iem/myer-cklvx-d62.webp"
sl41_img = "img/iem/myer-sl-41-mk-2.webp"
sl41_pro_img = "img/iem/myer-sl-41-pro.webp"
sl224_img = "img/iem/myer-sl-224.webp"

added = 0
for i in iems:
    iid = i["id"]
    low = i["name"].lower()
    
    # 1. Subtonic Storm variants
    if "subtonic" in low and "storm" in low:
        search_data[iid] = {
            "src": storm_img,
            "store": "Subtonic Audio",
            "url": "https://subtonic.audio/",
            "title": i["name"]
        }
        added += 1
    elif "the amalgam storm" in low or "sample storm" in low:
        search_data[iid] = {
            "src": storm_img,
            "store": "Subtonic Audio (Storm Base)",
            "url": "https://subtonic.audio/",
            "title": i["name"]
        }
        added += 1
        
    # 2. Myer / CKLVX / SLIIVO
    elif "cklvx d62" in low or "ck-d62" in low:
        search_data[iid] = {
            "src": d62_img,
            "store": "Myer-Audio / CKLVX",
            "url": "",
            "title": i["name"]
        }
        added += 1
    elif "sl-41 pro" in low or "sl41 pro" in low:
        search_data[iid] = {
            "src": sl41_pro_img,
            "store": "Myer-Audio / SLIIVO",
            "url": "",
            "title": i["name"]
        }
        added += 1
    elif "sl-41" in low or "sl41" in low or "d41" in low or "ck-d41" in low or "ck41" in low:
        search_data[iid] = {
            "src": sl41_img,
            "store": "Myer-Audio / SLIIVO",
            "url": "",
            "title": i["name"]
        }
        added += 1
    elif "sl224" in low or "sl-224" in low or "ck2v" in low or "sla3" in low:
        search_data[iid] = {
            "src": sl224_img,
            "store": "Myer-Audio / SLIIVO",
            "url": "",
            "title": i["name"]
        }
        added += 1
    elif "slt6" in low or "sliivo slt6" in low:
        search_data[iid] = {
            "src": sl41_pro_img,  # SLIIVO flagship shell
            "store": "Myer-Audio / SLIIVO",
            "url": "",
            "title": i["name"]
        }
        added += 1

search_file.write_text(json.dumps(search_data, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Mapped {added} Subtonic Storm and Myer Audio variants!")

