import json
import numpy as np

hp_file = 'app/public/data/headphones.json'
with open(hp_file, encoding='utf-8') as f:
    hp_data = json.load(f)

grid = np.array(hp_data['grid'])
frScale = hp_data['frScale']
iems = hp_data['iems']

sundaras = [i for i in iems if 'sundara' in i['name'].lower() and 'hifiman' in i['name'].lower()]
print(f"Total HiFiMAN Sundara entries: {len(sundaras)}")
for s in sundaras:
    print(f"ID: {s['id']:<45} | Name: {s['name']:<40} | Sources: {s['sources']}")

