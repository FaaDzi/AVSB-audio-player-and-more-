import json
import re
from pathlib import Path

ROOT = Path('.')

def load_json(p):
    return json.loads((ROOT / p).read_text(encoding='utf-8'))

shopImages = load_json('app/public/data/images.json')
archiveImages = load_json('app/public/data/images_archive.json')
searchImages = load_json('app/public/data/images_search.json')
brand_a = load_json('app/public/data/images_brand_a.json')
brand_b = load_json('app/public/data/images_brand_b.json')
brand_c = load_json('app/public/data/images_brand_c.json')

merged = {}
merged.update(searchImages)
merged.update(brand_a)
merged.update(brand_b)
merged.update(brand_c)
merged.update(archiveImages)
merged.update(shopImages)

aliases = load_json('app/public/data/aliases.json').get('merge', {})

hp = load_json('app/public/data/headphones.json')['iems']
iem = load_json('app/public/data/iems.json')['iems']

hp_missing = [h for h in hp if h['id'] not in aliases and h['id'] not in merged]
iem_missing = [i for i in iem if i['id'] not in aliases and i['id'] not in merged]

# Load all store products
stores_dir = ROOT / 'data/raw/stores'
products = []
bad_pattern = re.compile(r'open box|b-stock|refurb|cable|case|stand|adapter|cables|headband|filter|splitter|jack|plug|module|battery|cleaning', re.I)

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

print(f"Total store products: {len(products)}")

def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

def find_store_matches(items, label):
    matched = []
    for it in items:
        # Clean brand and model
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

hp_matches = find_store_matches(hp_missing, "HP")
iem_matches = find_store_matches(iem_missing, "IEM")

print(f"Missing HP: {len(hp_missing)}, Store Matches found: {len(hp_matches)}")
print(f"Missing IEM/TWS: {len(iem_missing)}, Store Matches found: {len(iem_matches)}")

print("\nSample HP store matches:")
for it, p in hp_matches[:10]:
    print(f"  {it['name']} -> {p['title']} ({p['store']})")

print("\nSample IEM/TWS store matches:")
for it, p in iem_matches[:10]:
    print(f"  {it['name']} -> {p['title']} ({p['store']})")

