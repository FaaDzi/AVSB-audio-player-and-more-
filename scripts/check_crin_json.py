import json

crin = json.load(open("data/reviewers/crinacle.json", encoding="utf-8"))
for k in ["hidition-viento-b-ciem", "hidition-violet"]:
    print(k, "in crinacle.json?", k in crin)

