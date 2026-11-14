import json

precog = json.load(open("data/reviewers/precogvision.json", encoding="utf-8"))
entries = precog.get("entries", [])
print("Precogvision total entries:", len(entries))
hp_entries = [e for e in entries if any(k in e["name"].lower() for k in ["sennheiser", "hifiman", "focal", "audeze", "beyerdynamic", "akg", "hd6", "hd8", "dt7", "dt8", "dt9", "clear", "utopia", "arya", "sundara", "susvara"])]
print("Precogvision headphone entries:", len(hp_entries))
for e in hp_entries[:10]:
    print(e["name"], e.get("grade"), e.get("quote")[:80] if e.get("quote") else "")

