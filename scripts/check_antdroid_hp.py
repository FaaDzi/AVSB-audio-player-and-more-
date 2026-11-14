import json

rows = json.load(open("data/raw/reviewers/antdroid/rows.json", encoding="utf-8"))
print("Antdroid total rows:", len(rows))
hp_rows = [r for r in rows if any(k in r["name"].lower() for k in ["sennheiser", "hifiman", "focal", "audeze", "beyerdynamic", "akg", "hd6", "hd8", "dt7", "dt8", "dt9", "clear", "utopia", "arya", "sundara"])]
print("Antdroid headphone rows:", len(hp_rows))
for r in hp_rows[:10]:
    print(r["name"], r["grade"], r["score"], r.get("link"))

