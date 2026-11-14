import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('app/public/data/headphones.json', encoding='utf-8') as f:
    hp = json.load(f)['iems']

families = [
    'hd 600', 'hd 650', 'hd 800', 'dt 770', 'dt 880', 'dt 990', 'dt 1990',
    'ath-m50', 'ath-r70', 'k240', 'k701', 'k702', 'k371', 'lcd-x', 'lcd-2',
    'maxwell', 'utopia', 'clear', 'ananda', 'arya', 'he400se', 'he6se'
]

for fam in families:
    matches = [i for i in hp if fam in i['name'].lower()]
    print(f"\nFamily: {fam.upper()} ({len(matches)} entries):")
    for m in matches[:10]:
        print(f"  {m['id']} | {m['name']}")
    if len(matches) > 10:
        print(f"  ... and {len(matches) - 10} more")

