import json
import re

with open('app/public/data/iems.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
iems = data['iems']

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

airlines = [i for i in iems if is_airline(i)]
protos = [i for i in iems if is_proto(i)]
ciems = [i for i in iems if is_ciem(i)]
mods = [i for i in iems if is_mod(i)]

print('Airlines:', len(airlines))
print('Prototypes:', len(protos))
print('CIEMs:', len(ciems))
print('Mods:', len(mods))
for m in mods:
    print(' ', m['id'], '|', m['name'])

