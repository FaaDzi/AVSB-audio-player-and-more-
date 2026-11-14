import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
from build_unified_cleaner import parse_model_info

hp = json.load(open('app/public/data/headphones.json', encoding='utf-8'))['iems']
sundaras = [i for i in hp if i['id'].startswith('hp-hifiman-sundara')]

for s in sundaras:
    info = parse_model_info(s['name'], s['id'], 'headphones')
    print(f"{s['id']:<45} | core_base: {info['core_base']:<20} | is_closed: {info['is_closed']} | is_open: {info['is_open']}")

