import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
hp = json.load(open('app/public/data/headphones.json', encoding='utf-8'))['iems']
aliases = json.load(open('app/public/data/aliases.json', encoding='utf-8'))['merge']

visible_sundaras = [i for i in hp if i['id'].startswith('hp-hifiman-sundara') and i['id'] not in aliases]
print(f"Visible hp-hifiman-sundara entries remaining: {len(visible_sundaras)}")
for s in visible_sundaras:
    print(f"  {s['id']:<45} | {s['name']}")

