import json
import re

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

print('=== PROTOTYPES (8 total) ===')
for i in iems:
    if is_proto(i):
        has = i['id'] in images
        print(f"  {'[HAS IMAGE]' if has else '[MISSING]'} {i['id']} | {i['name']}")
        if has:
            print(f"      -> {images[i['id']]['src']}")

print('\n=== CIEMS (5 total) ===')
for i in iems:
    if is_ciem(i):
        has = i['id'] in images
        print(f"  {'[HAS IMAGE]' if has else '[MISSING]'} {i['id']} | {i['name']}")
        if has:
            print(f"      -> {images[i['id']]['src']}")

print('\n=== MODS (48 total) ===')
for i in iems:
    if is_mod(i):
        has = i['id'] in images
        print(f"  {'[HAS IMAGE]' if has else '[MISSING]'} {i['id']} | {i['name']}")
        if has:
            print(f"      -> {images[i['id']]['src']}")

