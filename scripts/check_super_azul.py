import glob

for p in glob.glob("data/raw/reviewers/super-review/**/*.txt", recursive=True):
    content = open(p, encoding="utf-8", errors="ignore").read()
    if "azul" in content.lower():
        print(f"MATCH: {p}")

