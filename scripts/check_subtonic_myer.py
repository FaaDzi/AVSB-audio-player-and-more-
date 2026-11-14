import json

iems = json.load(open("app/public/data/iems.json", encoding="utf-8"))["iems"]
for i in iems:
    low = i["name"].lower()
    if "subtonic" in low or "storm" in low or "myer" in low or "slt6" in low or "cklvx" in low:
        print(f"{i['name']} -> id: {i['id']}")

