import json, re, glob
from pathlib import Path

# Load all products from data/raw/stores
stores_dir = Path('data/raw/stores')
products = []
for pfile in stores_dir.glob('*.json'):
    try:
        data = json.loads(pfile.read_text(encoding='utf-8'))
        for item in data:
            if item.get('images') and not re.search(r'open box|b-stock|refurb|cable|case|stand|pad|adapter|cables', item['title'], re.I):
                products.append({
                    'store': pfile.stem,
                    'title': item['title'],
                    'url': item['url'],
                    'image': item['images'][0]
                })
    except Exception:
        pass

print(f'Total products: {len(products)}')

# Check against missing reviewed items
rev = json.load(open('app/public/data/reviews.json', encoding='utf-8'))
rev_ids = set(rev.get('reviews', {}).keys()) | set(rev.get('comments', {}).keys()) | set(rev.get('videos', {}).keys())

jsonFiles = ['images.json', 'images_search.json', 'images_archive.json', 'images_brand_a.json', 'images_brand_b.json', 'images_brand_c.json']
merged = {}
for j in jsonFiles:
    try:
        merged.update(json.load(open(f'app/public/data/{j}', encoding='utf-8')))
    except Exception:
        pass

hp = json.load(open('app/public/data/headphones.json', encoding='utf-8'))['iems']
iem = json.load(open('app/public/data/iems.json', encoding='utf-8'))['iems']

missing_hp_rev = [h for h in hp if h['id'] in rev_ids and h['id'] not in merged]
missing_iem_rev = [i for i in iem if i['id'] in rev_ids and i['id'] not in merged]

print(f'Missing reviewed HP: {len(missing_hp_rev)}, IEM: {len(missing_iem_rev)}')

def normalize(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

matched_hp = []
for h in missing_hp_rev:
    hn = normalize(h['name'])
    for p in products:
        pn = normalize(p['title'])
        if hn in pn:
            matched_hp.append((h['id'], h['name'], p))
            break

matched_iem = []
for i in missing_iem_rev:
    in_ = normalize(i['name'])
    for p in products:
        pn = normalize(p['title'])
        if in_ in pn:
            matched_iem.append((i['id'], i['name'], p))
            break

print(f'Found {len(matched_hp)} HP matches and {len(matched_iem)} IEM matches in store feeds!')
for mid, name, p in matched_hp[:10]:
    print(f"  HP: {name} -> {p['title']} ({p['store']})")
for mid, name, p in matched_iem[:10]:
    print(f"  IEM: {name} -> {p['title']} ({p['store']})")

