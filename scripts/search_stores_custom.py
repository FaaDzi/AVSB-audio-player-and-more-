import json, glob
from pathlib import Path

queries = ['butastur', 'n5005', 'anole', 'radon', 'fdx1', 'duality', 'hook', 'erx', 'neon', 'sliivo', 'longinus', 't4', 'azul']

found = {}
for sf in glob.glob('data/raw/stores/*.json'):
    store_name = Path(sf).stem
    try:
        items = json.load(open(sf, encoding='utf-8'))
    except Exception:
        continue
    for item in items:
        title = item.get('title', '').lower()
        imgs = item.get('images', [])
        if not imgs:
            continue
        for q in queries:
            if q in title:
                if q not in found:
                    found[q] = []
                found[q].append({'store': store_name, 'title': item.get('title'), 'img': imgs[0], 'url': item.get('url')})

for q in queries:
    matches = found.get(q, [])
    print(f"=== {q} ({len(matches)} matches) ===")
    for m in matches[:3]:
        print(f"  {m['store']}: {m['title']} -> {m['img'][:80]}")

