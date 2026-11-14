import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('app/public/data/headphones.json', encoding='utf-8') as f:
    hp = json.load(f)['iems']

sundaras = [i for i in hp if i['id'].startswith('hp-hifiman-sundara')]
print(f"Total hp-hifiman-sundara entries: {len(sundaras)}")
for s in sundaras:
    print(f"{s['id']:<45} | {s['name']}")

