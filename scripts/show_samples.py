import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('data/duplicates_audit.json', encoding='utf-8') as f:
    audit = json.load(f)

print('--- HEADPHONE HIGHLY DUPLICATES (Sample) ---')
for item in audit['headphones']['highly_duplicates'][:20]:
    print(f"  {item['cand']}  -->  {item['keeper']} (RMS: {item['rms']:.2f} dB, Max: {item['max']:.2f} dB)")

print('\n--- HEADPHONE DUPLICATES (Sample) ---')
for item in audit['headphones']['duplicates'][:20]:
    print(f"  {item['cand']}  -->  {item['keeper']} (RMS: {item['rms']:.2f} dB, Max: {item['max']:.2f} dB)")

print('\n--- HEADPHONE MAYBE DUPLICATES (Sample) ---')
for item in audit['headphones']['maybe_duplicates'][:20]:
    print(f"  {item['cand']}  -->  {item['keeper']} (RMS: {item['rms']:.2f} dB, Max: {item['max']:.2f} dB)")

print('\n--- IEM HIGHLY DUPLICATES (Sample) ---')
for item in audit['iems']['highly_duplicates'][:20]:
    print(f"  {item['cand']}  -->  {item['keeper']} (RMS: {item['rms']:.2f} dB, Max: {item['max']:.2f} dB)")

