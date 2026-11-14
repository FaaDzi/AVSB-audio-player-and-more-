import json
import re
import sys
from pathlib import Path

ROOT = Path('.')
sys.path.insert(0, 'scripts')
from names import base, key

def load_json(p):
    return json.loads((ROOT / p).read_text(encoding='utf-8'))

jsonFiles = ['images.json', 'images_search.json', 'images_archive.json', 'images_brand_a.json', 'images_brand_b.json', 'images_brand_c.json']
merged = {}
for j in jsonFiles:
    try:
        merged.update(load_json(f'app/public/data/{j}'))
    except Exception:
        pass

hp = load_json('app/public/data/headphones.json')['iems']
aliases = load_json('app/public/data/aliases.json').get('merge', {})

# Build base image lookup - ONLY specific model families, NOT brand alone
base_lookup = {}
for h in hp:
    hid = h['id']
    if hid in merged:
        img_info = merged[hid]
        clean = re.sub(r'\(.*?\)', '', h['name']).strip()
        k_clean = key(clean)
        base_lookup.setdefault(k_clean, img_info)
        b = key(base(h['name']))
        base_lookup.setdefault(b, img_info)
        
        parts = hid.split('-')
        # Plen must be at least 3 for headphones (e.g. hp-brand-model)
        for plen in (5, 4, 3):
            if len(parts) >= plen:
                prefix = '-'.join(parts[:plen])
                base_lookup.setdefault(prefix, img_info)

new_mappings = {}
for h in hp:
    hid = h['id']
    if hid in aliases or hid in merged:
        continue
        
    clean = re.sub(r'\(.*?\)', '', h['name']).strip()
    k_clean = key(clean)
    img = base_lookup.get(k_clean)
    
    if not img:
        b = key(base(h['name']))
        img = base_lookup.get(b)
        
    if not img:
        parts = hid.split('-')
        for plen in (5, 4, 3):
            if len(parts) > plen:
                prefix = '-'.join(parts[:plen])
                if prefix in base_lookup:
                    img = base_lookup[prefix]
                    break
                    
    if img:
        new_mappings[hid] = {
            'src': img.get('src') or img.get('url'),
            'store': f"Base Model: {clean}",
            'url': img.get('url', ''),
            'title': h['name']
        }

print(f"Total precise headphone variant mappings: {len(new_mappings)}")
for hid, info in list(new_mappings.items())[:20]:
    print(f"  {hid} -> {info['src']} ({info['store']})")

