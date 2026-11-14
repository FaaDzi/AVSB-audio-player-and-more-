import json

search = json.load(open("app/public/data/images_search.json", encoding="utf-8"))
iems = json.load(open("app/public/data/iems.json", encoding="utf-8"))["iems"]

for i in iems:
    low = i["name"].lower()
    if "subtonic" in low or "myer" in low:
        iid = i["id"]
        in_search = iid in search
        src = search.get(iid, {}).get("src")
        print(f"{i['name']} ({iid}): in_search={in_search}, src={src}")

