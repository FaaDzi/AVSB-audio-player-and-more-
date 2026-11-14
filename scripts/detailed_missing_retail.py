import json
import re
from collections import Counter

with open('app/public/data/iems.json', 'r', encoding='utf-8') as f:
    iems = json.load(f)['iems']

def load_j(name):
    try:
        with open(f'app/public/data/{name}', 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {}

images = {}
images.update(load_j('images_search.json'))
for g in ['a', 'b', 'c']:
    images.update(load_j(f'images_brand_{g}.json'))
images.update(load_j('images_archive.json'))
images.update(load_j('images.json'))

reviews_data = load_j('reviews.json')
reviews = reviews_data.get('reviews', {})

def is_airline(i):
    s = f"{i['id']} {i['name']}".lower()
    return 'airline' in s or 'eva air' in s or 'krisworld' in s

def is_proto(i):
    s = f"{i['id']} {i['name']}".lower()
    if re.search(r'\b(prototype|pre-production|engineering sample)\b', s):
        return True
    if re.search(r'\bsample\s*([0-9]+|[a-z])?\b', s):
        return True
    if re.search(r'\bbeta\b', s):
        return True
    return False

def is_ciem(i):
    s = f"{i['id']} {i['name']}".lower()
    return bool(re.search(r'\bciem\b', s))

def is_mod(i):
    s = f"{i['id']} {i['name']}".lower()
    if any(k in s for k in ['shortbus', 'tanya filter', 'tape mod', 'mesh mod', 'zeus mod', 're-tune', 'prison mike mod', 'jaytiss custom tuned', 'modified']):
        return True
    if re.search(r'\b\d+\s+mesh\b', s):
        return True
    if re.search(r'\b(sponge|sponges)\b', s):
        return True
    if re.search(r'\b(mod|modded|diy mod|damping mod|nozzle mod)\b', s) and not any(k in s for k in ['module', 'mode', 'model']):
        return True
    return False

missing_retail = []
for i in iems:
    if i['id'] in images:
        continue
    if is_airline(i) or is_proto(i) or is_ciem(i) or is_mod(i):
        continue
    missing_retail.append(i)

print(f"Total missing commercial retail IEMs: {len(missing_retail)}")

reviewed_missing = [i for i in missing_retail if i['id'] in reviews and len(reviews[i['id']]) > 0]
print(f"Missing retail IEMs WITH reviewer notes: {len(reviewed_missing)}")
for r in reviewed_missing:
    author = reviews[r['id']][0].get('author', 'Unknown')
    score = reviews[r['id']][0].get('jay', {}).get('score')
    grade = reviews[r['id']][0].get('jay', {}).get('grade')
    print(f"  • {r['name']} ({r['id']}) - Reviewer: {author}, Score/Grade: {score or grade}")

brand_counts = Counter([i['name'].split()[0] for i in missing_retail])
print("\nMissing retail IEMs breakdown by Brand (Top 30):")
for b, c in brand_counts.most_common(30):
    print(f"  {b:15s}: {c} missing")

