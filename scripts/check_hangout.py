import glob
import json

for p in glob.glob("app/public/data/images*.json"):
    data = json.load(open(p, encoding="utf-8"))
    for k, v in data.items():
        if v.get("store") == "hangout.audio":
            print(k, "->", v)

