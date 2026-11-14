import json
import sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from frcodec import decode

hp_file = ROOT / 'app/public/data/headphones.json'
with open(hp_file, encoding='utf-8') as f:
    hp_data = json.load(f)

grid = np.array(hp_data['grid'])
frScale = hp_data['frScale']
iems = {i['id']: i for i in hp_data['iems']}

mid_idx = np.where((grid >= 200) & (grid <= 1000))[0]
full_idx = np.where((grid >= 20) & (grid <= 16000))[0]

def compare_curves(id_a, id_b):
    a = decode(iems[id_a]['fr']) * frScale
    b = decode(iems[id_b]['fr']) * frScale
    offset = np.mean(a[mid_idx] - b[mid_idx])
    diff = np.abs(a[full_idx] - (b[full_idx] + offset))
    max_diff = np.max(diff)
    rms_diff = np.sqrt(np.mean(diff**2))
    return max_diff, rms_diff

pairs = [
    ('hp-hifiman-sundara', 'hp-hifiman-sundara-open-back'),
    ('hp-hifiman-sundara', 'hp-hifiman-sundara-2020'),
    ('hp-hifiman-sundara', 'hp-hifiman-sundara-sundara-2022'),
    ('hp-hifiman-sundara', 'hp-hifiman-sundara-post-2020-earpads'),
    ('hp-hifiman-sundara', 'hp-hifiman-sundara-pre-2020-earpads'),
    ('hp-hifiman-sundara-2020', 'hp-hifiman-sundara-sundara-2022'),
    ('hp-hifiman-sundara-closed', 'hp-hifiman-sundara-closed-back'),
    ('hp-hifiman-sundara-closed-back', 'hp-hifiman-sundara-c'),
    ('hp-hifiman-sundara', 'hp-hifiman-sundara-silver'),
]

for a, b in pairs:
    max_d, rms_d = compare_curves(a, b)
    print(f"{iems[a]['name']} vs {iems[b]['name']}:")
    print(f"   Max gap: {max_d:.2f} dB | RMS gap: {rms_d:.2f} dB")

