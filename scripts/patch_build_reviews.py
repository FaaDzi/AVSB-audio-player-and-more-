from pathlib import Path

p = Path("scripts/build_reviews.py")
content = p.read_text(encoding="utf-8")

old_snippet = """    jay = json.loads(JAY.read_text(encoding="utf-8"))
    iems = json.loads(CATALOG.read_text(encoding="utf-8"))["iems"]
    aliases = json.loads(ALIASES_FILE.read_text(encoding="utf-8")) if ALIASES_FILE.exists() else {}

    by_key = {key(i["name"]): i["id"] for i in iems}
    by_name = {i["name"]: i["id"] for i in iems}
    by_base = defaultdict(set)
    for i in iems:
        by_base[key(base(i["name"]))].add(i["id"])"""

new_snippet = """    jay = json.loads(JAY.read_text(encoding="utf-8"))
    iems = json.loads(CATALOG.read_text(encoding="utf-8"))["iems"]
    headphones = json.loads(HEADPHONES.read_text(encoding="utf-8"))["iems"] if HEADPHONES.exists() else []
    all_gear = iems + headphones
    aliases = json.loads(ALIASES_FILE.read_text(encoding="utf-8")) if ALIASES_FILE.exists() else {}

    by_key = {key(i["name"]): i["id"] for i in all_gear}
    by_name = {i["name"]: i["id"] for i in all_gear}
    by_base = defaultdict(set)
    for i in all_gear:
        by_base[key(base(i["name"]))].add(i["id"])"""

# Normalize CRLF
content_norm = content.replace("\r\n", "\n")
old_norm = old_snippet.replace("\r\n", "\n")
new_norm = new_snippet.replace("\r\n", "\n")

if old_norm in content_norm:
    content_norm = content_norm.replace(old_norm, new_norm, 1)
    p.write_text(content_norm, encoding="utf-8")
    print("Successfully updated scripts/build_reviews.py")
else:
    print("Could not find old_norm in content_norm")

