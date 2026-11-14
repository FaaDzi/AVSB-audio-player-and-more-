import sys; sys.path.append('scripts')
import json, re
from build_unified_cleaner import parse_model_info

hp = json.load(open('app/public/data/headphones.json', encoding='utf-8'))['iems']
sundaras = [i for i in hp if i['id'].startswith('hp-hifiman-sundara')]

print("Sundaras grouped by core_base:")
by_core = {}
for s in sundaras:
    info = parse_model_info(s['name'], s['id'], 'headphones')
    by_core.setdefault(info['core_base'], []).append((s, info))

for core, items in by_core.items():
    print(f"\n--- CORE: {core} ({len(items)} items) ---")
    for s, info in items:
        print(f"  {s['id']} | {s['name']}")

