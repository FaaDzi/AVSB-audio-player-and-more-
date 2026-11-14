import json, re, glob, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from add_iem_image import add_image

stores_dir = ROOT / 'data/raw/stores'
products = []
bad_pattern = re.compile(r'open box|b-stock|refurb|cable|case|stand|pad|adapter|cables|headband|spring tips|earpad|cushion|filter|splitter|jack|plug|module|battery|cleaning', re.I)

for pfile in stores_dir.glob('*.json'):
    try:
        data = json.loads(pfile.read_text(encoding='utf-8'))
        for item in data:
            if item.get('images') and not bad_pattern.search(item['title']):
                products.append({
                    'store': pfile.stem,
                    'title': item['title'],
                    'url': item['url'],
                    'image': item['images'][0]
                })
    except Exception:
        pass

print(f'Total valid products: {len(products)}')

rev = json.load(open(ROOT / 'app/public/data/reviews.json', encoding='utf-8'))
rev_ids = set(rev.get('reviews', {}).keys()) | set(rev.get('comments', {}).keys()) | set(rev.get('videos', {}).keys())

jsonFiles = ['images.json', 'images_search.json', 'images_archive.json', 'images_brand_a.json', 'images_brand_b.json', 'images_brand_c.json']
merged = {}
for j in jsonFiles:
    try:
        merged.update(json.load(open(ROOT / f'app/public/data/{j}', encoding='utf-8')))
    except Exception:
        pass

hp = json.loads((ROOT / 'app/public/data/headphones.json').read_text(encoding='utf-8'))['iems']
iem = json.loads((ROOT / 'app/public/data/iems.json').read_text(encoding='utf-8'))['iems']

missing_hp = [h for h in hp if h['id'] in rev_ids and h['id'] not in merged]
missing_iem = [i for i in iem if i['id'] in rev_ids and i['id'] not in merged]

def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

def download_matches(items, label):
    success = 0
    for it in items:
        target_norm = norm(it['name'])
        best_p = None
        for p in products:
            p_norm = norm(p['title'])
            # check exact or strong submatch
            # Avoid single token false matches
            if len(target_norm) >= 6 and target_norm in p_norm:
                # verify not an accessory
                if not bad_pattern.search(p['title']):
                    best_p = p
                    break
        if best_p:
            img_url = best_p['image']
            if img_url.startswith('//'):
                img_url = 'https:' + img_url
            print(f"[{label}] Downloading {it['name']} from {best_p['store']}: {img_url}")
            try:
                res = add_image(
                    iem_id=it['id'],
                    image_url=img_url,
                    source_name=best_p['store'],
                    source_url=best_p['url'],
                    title=best_p['title']
                )
                if res:
                    print(f"  -> SUCCESS {it['id']}")
                    success += 1
                else:
                    print(f"  -> FAILED {it['id']}")
            except Exception as e:
                print(f"  -> ERROR {it['id']}: {e}")
    return success

s1 = download_matches(missing_hp, "HP")
s2 = download_matches(missing_iem, "IEM")
print(f"Successfully downloaded {s1} HP and {s2} IEM images!")

