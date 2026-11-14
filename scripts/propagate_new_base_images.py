import json
import re
import sys
from pathlib import Path

ROOT = Path('.')
sys.path.insert(0, 'scripts')
from names import base, key

def load_json(name):
    p = ROOT / 'app/public/data' / name
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

search_file = ROOT / 'app/public/data/images_search.json'
search_data = load_json('images_search.json')

aliases = load_json('aliases.json').get('merge', {})

hp = load_json('headphones.json')['iems']
iem = load_json('iems.json')['iems']

# Build clean base image dictionary
base_dict = {}

for gid, info in list(merged.items()):
    src = info.get('src') or info.get('url')
    if not src:
        continue
    parts = gid.split('-')
    if gid.startswith('hp-'):
        for plen in (5, 4, 3):
            if len(parts) >= plen:
                base_dict.setdefault('-'.join(parts[:plen]), info)
    else:
        for plen in (4, 3, 2):
            if len(parts) >= plen:
                base_dict.setdefault('-'.join(parts[:plen]), info)

for g in (hp + iem):
    gid = g['id']
    if gid in merged:
        info = merged[gid]
        clean = re.sub(r'\(.*?\)', '', g['name']).strip()
        base_dict.setdefault(key(clean), info)
        base_dict.setdefault(key(base(g['name'])), info)

print(f"Indexed {len(base_dict)} base keys.")

# Propagate to headphones (pad swaps, variants)
hp_added = 0
for h in hp:
    hid = h['id']
    if hid in aliases or hid in merged:
        continue
    clean = re.sub(r'\(.*?\)', '', h['name']).strip()
    k_clean = key(clean)
    k_b = key(base(h['name']))
    
    info = base_dict.get(k_clean) or base_dict.get(k_b)
    if not info:
        parts = hid.split('-')
        for plen in (5, 4, 3):
            if len(parts) > plen:
                prefix = '-'.join(parts[:plen])
                if prefix in base_dict:
                    info = base_dict[prefix]
                    break
    if info:
        search_data[hid] = {
            'src': info.get('src') or info.get('url'),
            'store': f"Base Model ({clean})",
            'url': info.get('url', ''),
            'title': h['name']
        }
        hp_added += 1

print(f"Propagated {hp_added} headphone images.")

# Propagate to IEMs & TWS
iem_added = 0
for i in iem:
    iid = i['id']
    if iid in aliases or iid in merged:
        continue
    clean = re.sub(r'\(.*?\)', '', i['name']).strip()
    k_clean = key(clean)
    k_b = key(base(i['name']))
    
    info = base_dict.get(k_clean) or base_dict.get(k_b)
    if not info:
        parts = iid.split('-')
        for plen in (4, 3, 2):
            if len(parts) > plen:
                prefix = '-'.join(parts[:plen])
                if prefix in base_dict:
                    info = base_dict[prefix]
                    break
    if info:
        search_data[iid] = {
            'src': info.get('src') or info.get('url'),
            'store': f"Base Model ({clean})",
            'url': info.get('url', ''),
            'title': i['name']
        }
        iem_added += 1

print(f"Propagated {iem_added} IEM/TWS images.")

search_file.write_text(json.dumps(search_data, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"Total search images now: {len(search_data)}")

