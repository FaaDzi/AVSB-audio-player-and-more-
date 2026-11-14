import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

def load_json(name):
    p = f'app/public/data/{name}'
    return json.load(open(p, encoding='utf-8'))

merged = {}
for j in ['images.json', 'images_search.json', 'images_archive.json', 'images_brand_a.json', 'images_brand_b.json', 'images_brand_c.json']:
    merged.update(load_json(j))

aliases = load_json('aliases.json').get('merge', {})
rev = load_json('reviews.json')
rev_ids = set(rev.get('reviews', {}).keys()) | set(rev.get('comments', {}).keys())

hp = load_json('headphones.json')['iems']
iem = load_json('iems.json')['iems']

hp_missing_rev = [h for h in hp if h['id'] not in aliases and h['id'] not in merged and h['id'] in rev_ids]
iem_missing_rev = [i for i in iem if i['id'] not in aliases and i['id'] not in merged and i['id'] in rev_ids]

print(f"--- MISSING REVIEWED HEADPHONES ({len(hp_missing_rev)}) ---")
for h in hp_missing_rev[:30]:
    print(f"  {h['id']} | {h['name']}")

print(f"\n--- MISSING REVIEWED IEMS ({len(iem_missing_rev)}) ---")
for i in iem_missing_rev[:30]:
    print(f"  {i['id']} | {i['name']}")

