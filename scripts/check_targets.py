import json

iems = json.load(open("app/public/data/iems.json", encoding="utf-8"))["iems"]

jsonFiles = [
    'images.json',
    'images_search.json',
    'images_archive.json',
    'images_brand_a.json',
    'images_brand_b.json',
    'images_brand_c.json'
]

mergedImages = {}
for j in jsonFiles:
    try:
        data = json.load(open(f"app/public/data/{j}", encoding="utf-8"))
        mergedImages.update(data)
    except Exception:
        pass

reviews = json.load(open("app/public/data/reviews.json", encoding="utf-8"))
allReviewed = set([
    *reviews.get("reviews", {}).keys(),
    *reviews.get("videos", {}).keys(),
    *reviews.get("comments", {}).keys()
])

TARGETS = ["subtonic", "storm", "myer", "slt6", "cklvx", "nightjar", "elysian", "symphonium", "64 audio", "annihilator"]

print("--- TARGET BOUTIQUE CHECK ---")
for i in iems:
    low = i["name"].lower()
    if any(t in low for t in TARGETS):
        hasImg = i["id"] in mergedImages
        hasRev = i["id"] in allReviewed
        imgSrc = mergedImages.get(i["id"], {}).get("src", "None") if hasImg else "None"
        revCount = (1 if i["id"] in reviews.get("reviews", {}) else 0) + len(reviews.get("comments", {}).get(i["id"], []))
        print(f"{i['name']} ({i['id']}): Image={hasImg} ({imgSrc}), Reviews={revCount}")

