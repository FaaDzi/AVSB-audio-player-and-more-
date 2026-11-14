import json
import re
import sys
from collections import defaultdict
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from frcodec import decode
from names import key

DATA = ROOT / 'app/public/data'

BRAND_FILLER = {'audio', 'acoustic', 'acoustics', 'hifi', 'technology', 'tech', 'electronics', 'inc', 'corporation'}
COLLAB = re.compile(r'\s+x\s+(crinacle|hbb|hawaiibadboy|gizaudio|z\s?reviews?|super\s?review|jay\s?audio|nerin|sunrise)\b', re.I)
NOISE = re.compile(r'\b(sample\s*\d*|unit\s*\d*|s\d\b|\d+(?:st|nd|rd|th)\s+(?:measurement|unit)|measurement\s*\d*|fresh stock(?:\s+pads)?|ideal seal|realistic seal|by\s+[^,()]+|serial number\s*\w+|sn\s*\w+|leakage)\b', re.I)
YEAR_OR_REV = re.compile(r'\b(19\d\d|20[0-2]\d|v[1-9]|mk[1-9]|gen\s*[1-9]|rev\s*[1-9]|2nd gen|3rd gen|4th gen|edition \d\d\d\d|post-20\d\d|pre-20\d\d)\b', re.I)
COLOR_OR_EDITION = re.compile(r'\b(silver|gold|black edition|white|special edition|limited edition)\b', re.I)
OHM_PATTERN = re.compile(r'\b(\d+(?:\.\d+)?)\s*(?:ohms?|Ω)\b', re.I)
POSITION_PATTERN = re.compile(r'\b(centre|center|down|front|rear|up)\b', re.I)
ENCLOSURE_CLOSED = re.compile(r'\b(closed[- ]back|closed|-c\b|sealed)\b', re.I)
ENCLOSURE_OPEN = re.compile(r'\b(open[- ]back|open)\b', re.I)

def parse_model_info(name, item_id, kind):
    full = f"{name} {item_id}".lower()
    
    ohm_match = OHM_PATTERN.search(full)
    ohm = float(ohm_match.group(1)) if ohm_match else None
    
    is_closed = bool(ENCLOSURE_CLOSED.search(full))
    is_open = bool(ENCLOSURE_OPEN.search(full))
    
    year_match = re.search(r'\b(19\d\d|20[0-2]\d)\b', full)
    year = int(year_match.group(1)) if year_match else None
    
    has_noise = bool(NOISE.search(name))
    is_position = bool(POSITION_PATTERN.search(name))
    
    clean = name
    clean = COLLAB.sub('', clean)
    clean = NOISE.sub('', clean)
    clean = re.sub(r'\[.*?\]', '', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    
    core = clean.lower()
    for w in BRAND_FILLER:
        core = re.sub(r'\b' + w + r'\b', '', core)
        
    enc_tag = ''
    if is_closed:
        enc_tag = '_closed'
        core = ENCLOSURE_CLOSED.sub('', core)
    elif is_open:
        core = ENCLOSURE_OPEN.sub('', core)
        
    core = COLOR_OR_EDITION.sub('', core)
    core_base = YEAR_OR_REV.sub('', core)
    core_base = re.sub(r'\(.*?\)', '', core_base)
    core_base = re.sub(r'[^a-z0-9]', '', core_base)
    core_base = core_base + enc_tag
    
    return {
        'clean_name': clean,
        'core_base': core_base,
        'ohm': ohm,
        'is_closed': is_closed,
        'is_open': is_open,
        'year': year,
        'has_noise': has_noise,
        'is_position': is_position
    }

def process_catalog(json_path, kind, reviews_set, images_dict, prices_dict):
    with open(json_path, encoding='utf-8') as f:
        data = json.load(f)
    
    grid = np.array(data['grid'])
    frScale = data['frScale']
    rows = data['iems']
    
    mid_idx = np.where((grid >= 200) & (grid <= 1000))[0]
    eval_idx = np.where((grid >= 20) & (grid <= 10000))[0]
    
    curves = {}
    for r in rows:
        try:
            c = decode(r['fr']) * frScale
            curves[r['id']] = c[eval_idx] - np.mean(c[mid_idx])
        except Exception:
            pass
            
    def curve_diff(id_a, id_b):
        if id_a not in curves or id_b not in curves:
            return 999.0, 999.0
        diff = np.abs(curves[id_a] - curves[id_b])
        return float(np.sqrt(np.mean(diff**2))), float(np.max(diff))
        
    def rank_row(r):
        return (
            10 if r['id'] in reviews_set else 0,
            5 if r['id'] in images_dict else 0,
            2 if r['id'] in prices_dict else 0,
            len(r.get('sources', []))
        )
        
    groups = defaultdict(list)
    for r in rows:
        info = parse_model_info(r['name'], r['id'], kind)
        if len(info['core_base']) >= 3:
            groups[info['core_base']].append((r, info))
        else:
            groups[r['name'].lower()].append((r, info))
            
    merges = {}
    duplicates = []
    highly_duplicates = []
    maybe_duplicates = []
    distinct_kept = []
    
    for core_key, items in groups.items():
        if len(items) < 2:
            continue
            
        items_sorted = sorted(items, key=lambda x: rank_row(x[0]), reverse=True)
        keeper, k_info = items_sorted[0]
        
        for cand, c_info in items_sorted[1:]:
            rms, max_gap = curve_diff(keeper['id'], cand['id'])
            
            # Rule 1: Headphones with different Ohms -> NEVER MERGE!
            if kind == 'headphones' and k_info['ohm'] is not None and c_info['ohm'] is not None:
                if abs(k_info['ohm'] - c_info['ohm']) > 5:
                    distinct_kept.append({
                        'cand': cand['name'],
                        'keeper': keeper['name'],
                        'reason': f"Different impedance ({c_info['ohm']}Ω vs {k_info['ohm']}Ω)",
                        'rms': rms
                    })
                    continue
                    
            # Rule 2: Open vs Closed -> NEVER MERGE!
            if (k_info['is_closed'] != c_info['is_closed']) or (k_info['is_open'] and c_info['is_closed']):
                distinct_kept.append({
                    'cand': cand['name'],
                    'keeper': keeper['name'],
                    'reason': "Open-back vs Closed-back enclosure",
                    'rms': rms
                })
                continue
                
            # Rule 3: Significant acoustic divergence (> 2.8 dB RMS) -> NEVER MERGE
            if rms > 2.8:
                distinct_kept.append({
                    'cand': cand['name'],
                    'keeper': keeper['name'],
                    'reason': f"Acoustic divergence (RMS: {rms:.2f} dB)",
                    'rms': rms
                })
                continue
                
            # Rule 4: DUPLICATE (Exact / Positional / Sample / Redundant Descriptor)
            is_same_clean = k_info['clean_name'].lower() == c_info['clean_name'].lower()
            is_pos = c_info['is_position'] or k_info['is_position']
            is_noise = c_info['has_noise'] or k_info['has_noise']
            is_redundant_enc = (k_info['is_closed'] and c_info['is_closed']) or (not k_info['is_closed'] and not c_info['is_closed'] and (k_info['is_open'] or c_info['is_open']))
            is_color = bool(COLOR_OR_EDITION.search(cand['name']))
            
            if is_same_clean or is_pos or (is_noise and rms < 1.8) or (is_redundant_enc and rms < 2.3) or (is_color and rms < 2.0) or (rms < 0.6 and max_gap < 2.0):
                duplicates.append({
                    'cand_id': cand['id'],
                    'cand_name': cand['name'],
                    'keeper_id': keeper['id'],
                    'keeper_name': keeper['name'],
                    'rms': rms,
                    'max': max_gap,
                    'reason': 'Exact / positional / redundant descriptor duplicate'
                })
                merges[cand['id']] = keeper['id']
                continue
                
            # Rule 5: HIGHLY DUPLICATE (Year revisions / version updates with RMS < 2.3 dB)
            has_year = (k_info['year'] != c_info['year']) or bool(re.search(r'\b(20\d\d|19\d\d)\b', cand['name']))
            has_rev = bool(re.search(r'\b(v[1-9]|mk[1-9]|gen\s*[1-9]|rev\s*[1-9]|2nd gen|3rd gen|4th gen)\b', cand['name'], re.I))
            has_earpads_rev = bool(re.search(r'\b(post-20\d\d|pre-20\d\d|earpads?)\b', cand['name'], re.I))
            
            if (has_year or has_rev or has_earpads_rev) and rms < 2.3:
                highly_duplicates.append({
                    'cand_id': cand['id'],
                    'cand_name': cand['name'],
                    'keeper_id': keeper['id'],
                    'keeper_name': keeper['name'],
                    'rms': rms,
                    'max': max_gap,
                    'reason': f"Year / revision rolling release (RMS: {rms:.2f} dB)"
                })
                merges[cand['id']] = keeper['id']
                continue
                
            # Rule 6: MAYBE DUPLICATE
            if rms <= 2.8:
                maybe_duplicates.append({
                    'cand_id': cand['id'],
                    'cand_name': cand['name'],
                    'keeper_id': keeper['id'],
                    'keeper_name': keeper['name'],
                    'rms': rms,
                    'max': max_gap,
                    'reason': f"Pad rolling / noticeable tuning drift (RMS: {rms:.2f} dB, Max: {max_gap:.2f} dB)"
                })
                
    return merges, duplicates, highly_duplicates, maybe_duplicates, distinct_kept

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    reviews_file = DATA / 'reviews.json'
    rev_data = json.loads(reviews_file.read_text(encoding='utf-8')) if reviews_file.exists() else {}
    reviews_set = set(rev_data.get('reviews', {}).keys()) | set(rev_data.get('comments', {}).keys())
    
    images = {}
    for f in ["images.json", "images_archive.json", "images_search.json", "images_brand_a.json", "images_brand_b.json", "images_brand_c.json"]:
        p = DATA / f
        if p.exists():
            images.update(json.loads(p.read_text(encoding='utf-8')))
            
    prices_file = DATA / 'prices.json'
    prices = json.loads(prices_file.read_text(encoding='utf-8')) if prices_file.exists() else {}
    
    existing_aliases = json.loads((DATA / 'aliases.json').read_text(encoding='utf-8')) if (DATA / 'aliases.json').exists() else {'merge': {}, 'families': {}}
    base_merges = existing_aliases.get('merge', {})
    families = existing_aliases.get('families', {})
    
    print("Processing Headphones...")
    hp_merges, hp_dups, hp_high, hp_maybe, hp_distinct = process_catalog(DATA / 'headphones.json', 'headphones', reviews_set, images, prices)
    
    print("Processing IEMs & TWS...")
    iem_merges, iem_dups, iem_high, iem_maybe, iem_distinct = process_catalog(DATA / 'iems.json', 'iems', reviews_set, images, prices)
    
    combined_merges = dict(base_merges)
    combined_merges.update(hp_merges)
    combined_merges.update(iem_merges)
    
    for d in list(combined_merges):
        seen = {d}
        curr = combined_merges[d]
        while curr in combined_merges and curr not in seen:
            seen.add(curr)
            curr = combined_merges[curr]
        combined_merges[d] = curr

    out_payload = {
        'merge': combined_merges,
        'families': families
    }
    (DATA / 'aliases.json').write_text(json.dumps(out_payload, ensure_ascii=False, indent=2), encoding='utf-8')
    
    print("\n================ CLEANUP SUMMARY ================")
    print(f"Total entries in aliases.json 'merge': {len(combined_merges)} (was {len(base_merges)})")
    print(f"Headphone merges added: {len(hp_merges)}")
    print(f"  - Exact duplicates merged: {len(hp_dups)}")
    print(f"  - Highly duplicate (year/rev) merged: {len(hp_high)}")
    print(f"  - Maybe duplicate (kept separate for review): {len(hp_maybe)}")
    print(f"  - Distinct variants preserved (Ohms, Open/Closed): {len(hp_distinct)}")
    print(f"\nIEM/TWS merges added: {len(iem_merges)}")
    print(f"  - Exact duplicates merged: {len(iem_dups)}")
    print(f"  - Highly duplicate (year/rev) merged: {len(iem_high)}")
    print(f"  - Maybe duplicate (kept separate for review): {len(iem_maybe)}")
    print(f"  - Distinct variants preserved: {len(iem_distinct)}")

    # Write detailed JSON audit for inspection
    audit_data = {
        'headphones': {
            'duplicates': hp_dups,
            'highly_duplicates': hp_high,
            'maybe_duplicates': hp_maybe,
            'distinct_variants': hp_distinct
        },
        'iems': {
            'duplicates': iem_dups,
            'highly_duplicates': iem_high,
            'maybe_duplicates': iem_maybe,
            'distinct_variants': iem_distinct
        }
    }
    (ROOT / 'data/duplicates_audit.json').write_text(json.dumps(audit_data, ensure_ascii=False, indent=2), encoding='utf-8')

if __name__ == '__main__':
    main()

