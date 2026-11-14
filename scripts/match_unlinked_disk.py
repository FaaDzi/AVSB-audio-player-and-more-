import os, glob, json, re

def norm(s):
    s = re.sub(r'[^a-z0-9]', '', s.lower())
    s = s.replace('headphone', '').replace('headphones', '').replace('audio', '').replace('tws', '').replace('earbuds', '').replace('iem', '')
    s = s.replace('two', '2').replace('three', '3').replace('four', '4')
    return s

disk_files = glob.glob('app/public/img/iem/*.webp')
disk_map = {}
for f in disk_files:
    fname = os.path.basename(f)
    base_name = fname[:-5]
    disk_map[norm(base_name)] = fname
    # also strip 'hp-' prefix
    if base_name.startswith('hp-'):
        disk_map[norm(base_name[3:])] = fname

search_file = 'app/public/data/images_search.json'
with open(search_file, encoding='utf-8') as f:
    search_data = json.load(f)

hp = json.load(open('app/public/data/headphones.json', encoding='utf-8'))['iems']
iem = json.load(open('app/public/data/iems.json', encoding='utf-8'))['iems']
all_gear = hp + iem

all_images = set(search_data.keys())
for p in glob.glob('app/public/data/images*.json'):
    if os.path.abspath(p) != os.path.abspath(search_file):
        all_images.update(json.load(open(p, encoding='utf-8')).keys())

new_matches = {}
for g in all_gear:
    gid = g['id']
    if gid in all_images:
        continue
    g_norm = norm(gid)
    target_f = disk_map.get(g_norm)
    if not target_f:
        name_norm = norm(g['name'])
        target_f = disk_map.get(name_norm)
    
    if target_f:
        new_matches[gid] = {
            'src': f'/img/iem/{target_f}',
            'store': 'Local Asset',
            'url': '',
            'title': g['name']
        }

print(f'Found {len(new_matches)} unlinked disk matches!')
for k, v in list(new_matches.items())[:20]:
    print(f"  {k} -> {v['src']}")

search_data.update(new_matches)
with open(search_file, 'w', encoding='utf-8') as f:
    json.dump(search_data, f, indent=2, ensure_ascii=False)

