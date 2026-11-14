import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('data/duplicates_audit.json', encoding='utf-8') as f:
    audit = json.load(f)

for category in ['duplicates', 'highly_duplicates', 'maybe_duplicates']:
    items = [x for x in audit['headphones'][category] if 'sundara' in x['cand'].lower() or 'sundara' in x['keeper'].lower()]
    print(f'=== Sundara in {category} ({len(items)}) ===')
    for x in items[:25]:
        print(f"  {x['cand']}  -->  {x['keeper']} (RMS: {x['rms']:.2f} dB, reason: {x['reason']})")

