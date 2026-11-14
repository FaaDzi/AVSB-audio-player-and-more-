import json

search_path = "app/public/data/images_search.json"
search = json.load(open(search_path, encoding="utf-8"))

for k in ["night-oblivion-longinus-nolonginus00", "night-oblivion-longinus-nolonginus01", "night-oblivion-longinus-nolonginus10"]:
    search[k] = {
        "src": "img/iem/night-oblivion-longinus.webp",
        "store": "Beyond The Music",
        "url": "https://beyondthemusicid.com/products/night-oblivion-longinus",
        "title": f"{k} (derived)"
    }

json.dump(search, open(search_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("Updated Longinus variants to point to night-oblivion-longinus.webp!")

