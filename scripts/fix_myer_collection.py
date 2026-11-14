import json

search_path = "app/public/data/images_search.json"
search = json.load(open(search_path, encoding="utf-8"))

# Myer SLT6 variants
for v in ["off-off", "off-on", "on-off", "on-on"]:
    search[f"meyer-audio-sliivo-slt6-{v}"] = {
        "src": "img/iem/myer-sl-224.webp",
        "store": "hangout.audio",
        "url": "https://hangout.audio/products/myer-audio-sliivo-sl224",
        "title": f"Meyer Audio SLIIVO SLT6 ({v})"
    }

# CKLVX and CK2V
search["cklvx-1dd-4ba"] = {
    "src": "img/iem/myer-sl-224.webp",
    "store": "hangout.audio",
    "url": "https://hangout.audio/products/myer-audio-sliivo-sl224",
    "title": "CKLVX 1DD+4BA (D41)"
}

search["myer-ck2v"] = {
    "src": "img/iem/myer-sl-224.webp",
    "store": "hangout.audio",
    "url": "https://hangout.audio/products/myer-audio-sliivo-sl224",
    "title": "MYER CK2V"
}

search["myer-cklvx"] = {
    "src": "img/iem/myer-sl-224.webp",
    "store": "hangout.audio",
    "url": "https://hangout.audio/products/myer-audio-sliivo-sl224",
    "title": "MYER CKLVX"
}

json.dump(search, open(search_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("Mapped all remaining MYER / CKLVX / SLIIVO items into images_search.json!")

