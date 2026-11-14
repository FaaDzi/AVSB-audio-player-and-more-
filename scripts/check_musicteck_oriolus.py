import json

items = json.load(open("data/raw/stores/shop.musicteck.com.json", encoding="utf-8"))
for it in items:
    t = it.get("title", "")
    if "oriolus" in t.lower():
        imgs = it.get("images", [])
        print(t, "->", imgs[:1], it.get("url"))

