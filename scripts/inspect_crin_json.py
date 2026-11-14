import json

crin = json.load(open("data/reviewers/crinacle.json", encoding="utf-8"))
print("Current Crinacle items count:", len(crin))
sample_key = list(crin.keys())[0]
print("Sample entry:", sample_key, "->", json.dumps(crin[sample_key], indent=2))

