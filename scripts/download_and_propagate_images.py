import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from add_iem_image import add_image
from names import base, key

DATA = ROOT / 'app/public/data'

def load_json(filename):
    p = DATA / filename
    if p.exists():
        return json.loads(p.read_text(encoding='utf-8'))
    return {}

jsonFiles = ['images.json', 'images_search.json', 'images_archive.json', 'images_brand_a.json', 'images_brand_b.json', 'images_brand_c.json']
merged = {}
for j in jsonFiles:
    try:
        merged.update(load_json(j))
    except Exception:
        pass

search_file = DATA / 'images_search.json'
search_data = load_json('images_search.json')

aliases = load_json('aliases.json').get('merge', {})

hp = load_json('headphones.json')['iems']
iem = load_json('iems.json')['iems']

hp_missing = [h for h in hp if h['id'] not in aliases and h['id'] not in merged]
iem_missing = [i for i in iem if i['id'] not in aliases and i['id'] not in merged]

print(f"Initial missing visible HP: {len(hp_missing)}")
print(f"Initial missing visible IEM/TWS: {len(iem_missing)}")

# 1. Load clean store products
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

print(f"Loaded {len(products)} clean store products.")

def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

# Match items to store products
def match_items(items):
    matches = {}
    for it in items:
        clean = re.sub(r'\(.*?\)', '', it['name']).strip()
        target_norm = norm(clean)
        if len(target_norm) < 4:
            continue
        best = None
        for p in products:
            p_norm = norm(p['title'])
            if target_norm == p_norm or (len(target_norm) >= 6 and target_norm in p_norm):
                best = p
                break
        if best:
            matches[it['id']] = (it, best)
    return matches

hp_matches = match_items(hp_missing)
iem_matches = match_items(iem_missing)

print(f"Found {len(hp_matches)} HP store matches to download.")
print(f"Found {len(iem_matches)} IEM store matches to download.")

# Download matches
downloaded_hp = 0
downloaded_iem = 0

all_to_download = [('HP', it, p) for it, p in hp_matches.values()] + [('IEM', it, p) for it, p in iem_matches.values()]

for kind, it, p in all_to_download:
    img_url = p['image']
    if img_url.startswith('//'):
        img_url = 'https:' + img_url
    try:
        res = add_image(
            iem_id=it['id'],
            image_url=img_url,
            source_name=p['store'],
            source_url=p['url'],
            title=p['title']
        )
        if res:
            if kind == 'HP':
                downloaded_hp += 1
            else:
                downloaded_iem += 1
            print(f"[{kind}] Downloaded {it['name']} -> {it['id']}")
    except Exception as e:
        print(f"[{kind}] Error downloading {it['id']}: {e}")

print(f"\nSuccessfully downloaded: {downloaded_hp} HP, {downloaded_iem} IEM images.")

# Reload merged images after download
search_data = load_json('images_search.json')
merged.update(search_data)

# 2. Propagate base headphone images to pad swap / modded / multi-variants
hp_propagated = 0
base_lookup_hp = {}
for h in hp:
    hid = h['id']
    if hid in merged:
        img_info = merged[hid]
        clean = re.sub(r'\(.*?\)', '', h['name']).strip()
        base_lookup_hp.setdefault(key(clean), img_info)
        base_lookup_hp.setdefault(key(base(h['name'])), img_info)
        parts = hid.split('-')
        for plen in (5, 4, 3):
            if len(parts) >= plen:
                base_lookup_hp.setdefault('-'.join(parts[:plen]), img_info)

for h in hp:
    hid = h['id']
    if hid in aliases or hid in merged or hid in search_data:
        continue
    clean = re.sub(r'\(.*?\)', '', h['name']).strip()
    img = base_lookup_hp.get(key(clean)) or base_lookup_hp.get(key(base(h['name'])))
    if not img:
        parts = hid.split('-')
        for plen in (5, 4, 3):
            if len(parts) > plen:
                prefix = '-'.join(parts[:plen])
                if prefix in base_lookup_hp:
                    img = base_lookup_hp[prefix]
                    break
    if img:
        search_data[hid] = {
            'src': img.get('src') or img.get('url'),
            'store': f"Base Model ({clean})",
            'url': img.get('url', ''),
            'title': h['name']
        }
        hp_propagated += 1

print(f"Propagated {hp_propagated} headphone variant / pad-swap images.")

# 3. Propagate base IEM images to tip / modded / tuning variants
iem_propagated = 0
base_lookup_iem = {}
for i in iem:
    iid = i['id']
    if iid in merged or iid in search_data:
        img_info = search_data.get(iid) or merged.get(iid)
        clean = re.sub(r'\(.*?\)', '', i['name']).strip()
        base_lookup_iem.setdefault(key(clean), img_info)
        base_lookup_iem.setdefault(key(base(i['name'])), img_info)
        parts = iid.split('-')
        for plen in (4, 3, 2):
            if len(parts) >= plen:
                base_lookup_iem.setdefault('-'.join(parts[:plen]), img_info)

for i in iem:
    iid = i['id']
    if iid in aliases or iid in merged or iid in search_data:
        continue
    clean = re.sub(r'\(.*?\)', '', i['name']).strip()
    img = base_lookup_iem.get(key(clean)) or base_lookup_iem.get(key(base(i['name'])))
    if not img:
        parts = iid.split('-')
        for plen in (4, 3, 2):
            if len(parts) > plen:
                prefix = '-'.join(parts[:plen])
                if prefix in base_lookup_iem:
                    img = base_lookup_iem[prefix]
                    break
    if img:
        search_data[iid] = {
            'src': img.get('src') or img.get('url'),
            'store': f"Base Model ({clean})",
            'url': img.get('url', ''),
            'title': i['name']
        }
        iem_propagated += 1

print(f"Propagated {iem_propagated} IEM / TWS variant images.")

# Save updated images_search.json
search_file.write_text(json.dumps(search_data, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"Saved images_search.json! (Total search entries: {len(search_data)})")

