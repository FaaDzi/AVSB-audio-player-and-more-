import json

crin = json.load(open("data/reviewers/crinacle.json", encoding="utf-8"))
print("Keys:", list(crin.keys())[:10])
if "reviews" in crin:
    print("Reviews count:", len(crin["reviews"]))
    first_key = list(crin["reviews"].keys())[0]
    print("Sample review:", first_key, "->", json.dumps(crin["reviews"][first_key], indent=2))

