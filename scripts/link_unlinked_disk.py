import json
from pathlib import Path

ROOT = Path(".")
search_file = ROOT / "app/public/data/images_search.json"
search_data = json.load(open(search_file, encoding="utf-8"))

unlinked_map = {
    "beyerdynamic-xelento": "img/iem/beyerdynamic-xelento.webp",
    "campfire-audio-andromeda": "img/iem/campfire-audio-andromeda.webp",
    "campfire-audio-pathfinder": "img/iem/campfire-audio-pathfinder.webp",
    "dunu-talos": "img/iem/dunu-talos.webp",
    "hidizs-ms2": "img/iem/hidizs-ms2.webp",
    "moondrop-golden-ages": "img/iem/moondrop-golden-ages.webp",
    "shanling-sono": "img/iem/shanling-sono.webp",
    "tempotec-im05": "img/iem/tempotec-im05.webp",
    "whizzer-kylin-he10": "img/iem/whizzer-kylin-he10.webp",
    "bgvp-scale": "img/iem/bgvp-scale.webp",
    "binary-ep321": "img/iem/binary-ep321-stock.webp",
    "bqeyz-autumn": "img/iem/bqeyz-autumn.webp",
    "nd-planet": "img/iem/nd-planet.webp"
}

iems = json.load(open(ROOT / "app/public/data/iems.json", encoding="utf-8"))["iems"]

added = 0
for prefix, src in unlinked_map.items():
    for item in iems:
        if item["id"].startswith(prefix) and item["id"] not in search_data:
            search_data[item["id"]] = {
                "src": src,
                "store": "Official / Manufacturer",
                "url": "",
                "title": item["name"]
            }
            added += 1

search_file.write_text(json.dumps(search_data, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Linked {added} entries for the unlinked files!")

