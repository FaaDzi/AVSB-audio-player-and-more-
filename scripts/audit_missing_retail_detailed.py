import json
import re
from collections import Counter, defaultdict

with open('app/public/data/iems.json', 'r', encoding='utf-8') as f:
    iems = json.load(f)['iems']

def load_j(name):
    try:
        with open(f'app/public/data/{name}', 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {}

images = {}
images.update(load_j('images_search.json'))
for g in ['a', 'b', 'c']:
    images.update(load_j(f'images_brand_{g}.json'))
images.update(load_j('images_archive.json'))
images.update(load_j('images.json'))

reviews_data = load_j('reviews.json')
reviews = reviews_data.get('reviews', {})

prices = load_j('prices.json')

def is_airline(i):
    s = f"{i['id']} {i['name']}".lower()
    return 'airline' in s or 'eva air' in s or 'krisworld' in s

def is_proto(i):
    s = f"{i['id']} {i['name']}".lower()
    if re.search(r'\b(prototype|pre-production|engineering sample)\b', s):
        return True
    if re.search(r'\bsample\s*([0-9]+|[a-z])?\b', s):
        return True
    if re.search(r'\bbeta\b', s):
        return True
    return False

def is_ciem(i):
    s = f"{i['id']} {i['name']}".lower()
    return bool(re.search(r'\bciem\b', s))

def is_mod(i):
    s = f"{i['id']} {i['name']}".lower()
    if any(k in s for k in ['shortbus', 'tanya filter', 'tape mod', 'mesh mod', 'zeus mod', 're-tune', 'prison mike mod', 'jaytiss custom tuned', 'modified']):
        return True
    if re.search(r'\b\d+\s+mesh\b', s):
        return True
    if re.search(r'\b(sponge|sponges)\b', s):
        return True
    if re.search(r'\b(mod|modded|diy mod|damping mod|nozzle mod)\b', s) and not any(k in s for k in ['module', 'mode', 'model']):
        return True
    return False

missing_retail = []
for i in iems:
    if i['id'] in images:
        continue
    if is_airline(i) or is_proto(i) or is_ciem(i) or is_mod(i):
        continue
    missing_retail.append(i)

print(f"Total missing commercial retail IEM entries: {len(missing_retail)}")

# Group by brand
by_brand = defaultdict(list)
for i in missing_retail:
    brand = i['name'].split()[0]
    by_brand[brand].append(i)

# Categorize brands into:
# Tier 1: Major Audiophile / Chi-Fi Brands with missing entries
# Tier 2: Consumer / TWS / Smartphone Brands (Samsung, Huawei, Tronsmart, Creative)
# Tier 3: Obscure / Boutique / Discontinued Chi-Fi

tier1_brands = ['Moondrop', 'KZ', 'TRN', 'Letshuoer', 'SeeAudio', 'Shozy', 'Shuoer', 'QoA', 'Blon', 'CVJ', 'QKZ', 'Whizzer', 'Reecho', 'TFZ', 'Smabat', 'Etymotic', 'Penon', 'TSMR', 'FLC', 'Magaosi']
tws_brands = ['Samsung', 'Huawei', 'Tronsmart', 'SoundPeats', 'Creative', 'Realme', 'Anker', 'Soundcore']

t1_list = []
tws_list = []
obscure_list = []

for b, items in by_brand.items():
    if b in tier1_brands:
        t1_list.extend(items)
    elif b in tws_brands:
        tws_list.extend(items)
    else:
        obscure_list.extend(items)

print(f"\n1. Major Chi-Fi / Audiophile Brands: {len(t1_list)} entries")
for b in tier1_brands:
    if b in by_brand:
        print(f"   • {b} ({len(by_brand[b])}): {', '.join([x['name'] for x in by_brand[b][:5]])}{'...' if len(by_brand[b]) > 5 else ''}")

print(f"\n2. Consumer TWS & Tech Phone Brands: {len(tws_list)} entries")
for b in tws_brands:
    if b in by_brand:
        print(f"   • {b} ({len(by_brand[b])}): {', '.join([x['name'] for x in by_brand[b][:4]])}{'...' if len(by_brand[b]) > 4 else ''}")

print(f"\n3. Obscure / Boutique / Discontinued Chi-Fi: {len(obscure_list)} entries across {len(set(i['name'].split()[0] for i in obscure_list))} niche brands")

# Detailed list of obscure brands
obscure_by_brand = Counter([i['name'].split()[0] for i in obscure_list])
for b, count in obscure_by_brand.most_common(20):
    print(f"   • {b} ({count}): {', '.join([x['name'] for x in obscure_list if x['name'].split()[0] == b][:3])}")
