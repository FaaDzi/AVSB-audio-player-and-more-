import json

crin = json.load(open("data/reviewers/crinacle.json", encoding="utf-8"))
entries = crin["entries"]
print("Entries count:", len(entries))
print("Sample entry 0:", json.dumps(entries[0], indent=2))

