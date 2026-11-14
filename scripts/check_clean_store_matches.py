import json
import re
from pathlib import Path

ROOT = Path('.')

def load_json(p):
    return json.loads((ROOT / p).read_text(encoding='utf-8'))

jsonFiles = ['images.json', 'images_search.json', 'images_archive.json', 'images_brand_a.json', 'images_brand_b.json', 'images_brand_c.json']
merged = {}
for j in jsonFiles:
    try:
        merged.update(load_json(f'app/public/data/{j}'))
    except Exception:
        pass

aliases = load_json('app/public/data/aliases.json').get('merge', {})

hp = load_json('app/public/data/headphones.json')['iems']
iem = load_json('app/public/data/iems.json')['iems']

hp_missing = [h for h in hp if h['id'] not in aliases and h['id'] not in merged]
iem_missing = [i for i in iem if i['id'] not in aliases and i['id'] not in merged]

stores_dir = ROOT / 'data/raw/stores'
products = []
bad_pattern = re.compile(r'open box|b-stock|refurb|cable|case|stand|adapter|cables|headband|filter|splitter|jack|plug|module|battery|cleaning|sweatz|earpad|pads?|cushion|cover|hanger|dongle|replacement', re.I)

for pfile in stores_dir.glob('*.json'):
    try:
        data = json.loads(pfile.read_text(encoding='utf-8'))
        for item in data:
            if item.get('images') and not bad_pattern.search(item['title']):
                products.append({
                    'store': pfile.stem,
                    'title': item['title'],
                    'url': item['url'],
                    'image': item['images'][0]
                })
    except Exception:
        pass

print(f"Clean store products (excluding accessories/pads): {len(products)}")

def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

def find_store_matches(items):
    matched = []
    for it in items:
        clean = re.sub(r'\(.*?\)', '', it['name']).strip()
        target_norm = norm(clean)
        if len(target_norm) < 4:
            continue
            
        best = None
        for p in products:
            p_norm = norm(p['title'])
            if target_norm == p_norm:
                best = p
                break
            if len(target_norm) >= 6 and target_norm in p_norm:
                best = p
                break
                
        if best:
            matched.append((it, best))
    return matched

hp_matches = find_store_matches(hp_missing)
iem_matches = find_store_matches(iem_missing)

print(f"Verified HP store matches: {len(hp_matches)}")
for it, p in hp_matches[:15]:
    print(f"  {it['name']} -> {p['title']} ({p['store']})")

print(f"\nVerified IEM/TWS store matches: {len(iem_matches)}")
for it, p in iem_matches[:15]:
    print(f"  {it['name']} -> {p['title']} ({p['store']})")

