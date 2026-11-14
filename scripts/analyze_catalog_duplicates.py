import json
import re
import sys
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from frcodec import decode
from names import key

def clean_brand_name(name):
    s = name.lower()
    s = re.sub(r'\[.*?\]', '', s)
    s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'\b(audio|acoustics?|ears?|hifi|technology|tech|electronics)\b', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def extract_features(name, item_id):
    full = f"{name} {item_id}".lower()
    
    # Check Ohm
    ohm_match = re.search(r'\b(\d+(?:\.\d+)?)\s*(?:ohms?|Ω)\b', full)
    ohm = float(ohm_match.group(1)) if ohm_match else None
    
    # Check Year
    year_match = re.search(r'\b(19\d\d|20[0-2]\d)\b', full)
    year = int(year_match.group(1)) if year_match else None
    
    # Check Open vs Closed
    is_closed = bool(re.search(r'\b(closed|closed-back|-c\b|sealed)\b', full))
    is_open = bool(re.search(r'\b(open|open-back)\b', full))
    
    # Check revision/version
    rev_match = re.search(r'\b(v[1-9]|mk[1-9]|gen\s*[1-9]|rev\s*[1-9]|stealth|organic|unveiled)\b', full)
    revision = rev_match.group(1) if rev_match else None
    
    # Check sample/unit/bookkeeping noise
    has_sample_noise = bool(re.search(r'\b(sample\s*\d*|unit\s*\d*|s\d\b|measurement\s*\d*|fresh stock|ideal seal|realistic seal|by\s+[^,()]+)\b', full))
    
    # Check pad rolling
    has_pad_rolling = bool(re.search(r'\b(pads?|earpads?|dekoni|yaxi|alcantara|sheepskin|velour|fenestrated)\b', full))

    return {
        'ohm': ohm,
        'year': year,
        'is_closed': is_closed,
        'is_open': is_open,
        'revision': revision,
        'has_sample_noise': has_sample_noise,
        'has_pad_rolling': has_pad_rolling
    }

def analyze_dataset(json_path, kind):
    with open(json_path, encoding='utf-8') as f:
        data = json.load(f)
    
    grid = np.array(data['grid'])
    frScale = data['frScale']
    rows = data['iems']
    
    # Load ranking criteria: reviews, images, prices
    reviews_file = ROOT / 'app/public/data/reviews.json'
    rev_data = json.loads(reviews_file.read_text(encoding='utf-8')) if reviews_file.exists() else {}
    rev_ids = set(rev_data.get('reviews', {}).keys()) | set(rev_data.get('comments', {}).keys())
    
    images = {}
    for f in ["images.json", "images_archive.json", "images_search.json", "images_brand_a.json", "images_brand_b.json", "images_brand_c.json"]:
        p = ROOT / "app/public/data" / f
        if p.exists():
            images.update(json.loads(p.read_text(encoding='utf-8')))
            
    prices_file = ROOT / 'app/public/data/prices.json'
    prices = json.loads(prices_file.read_text(encoding='utf-8')) if prices_file.exists() else {}
    
    def score_row(r):
        return (
            10 if r['id'] in rev_ids else 0,
            5 if r['id'] in images else 0,
            2 if r['id'] in prices else 0,
            len(r.get('sources', []))
        )
    
    # Decode curves and compute mid level
    mid_idx = np.where((grid >= 200) & (grid <= 1000))[0]
    eval_idx = np.where((grid >= 20) & (grid <= 10000))[0]
    
    print(f"Decoding {len(rows)} curves for {kind}...")
    curves = {}
    for r in rows:
        try:
            c = decode(r['fr']) * frScale
            # Level-align to mid
            offset = np.mean(c[mid_idx])
            curves[r['id']] = c[eval_idx] - offset
        except Exception as e:
            pass
            
    def curve_diff(id_a, id_b):
        if id_a not in curves or id_b not in curves:
            return 999.0, 999.0
        diff = np.abs(curves[id_a] - curves[id_b])
        return float(np.sqrt(np.mean(diff**2))), float(np.max(diff))
    
    # Group by loose model name
    groups = defaultdict(list)
    for r in rows:
        base_k = clean_brand_name(r['name'])
        # Also clean year and version from base key to group revisions together
        base_clean = re.sub(r'\b(19\d\d|20[0-2]\d|v[1-9]|mk[1-9]|gen\s*[1-9]|rev\s*[1-9])\b', '', base_k)
        base_clean = re.sub(r'\s+', ' ', base_clean).strip()
        groups[base_clean].append(r)
        
    duplicates = []
    highly_duplicates = []
    maybe_duplicates = []
    distinct_variants = []
    
    for base_name, group in groups.items():
        if len(group) < 2:
            continue
            
        # Find best candidate to keep
        ranked_group = sorted(group, key=score_row, reverse=True)
        keeper = ranked_group[0]
        keeper_feat = extract_features(keeper['name'], keeper['id'])
        
        for cand in ranked_group[1:]:
            cand_feat = extract_features(cand['name'], cand['id'])
            rms_gap, max_gap = curve_diff(keeper['id'], cand['id'])
            
            # Rule 1: Different Ohm in headphones -> DO NOT MERGE!
            if kind == 'headphones' and keeper_feat['ohm'] is not None and cand_feat['ohm'] is not None:
                if abs(keeper_feat['ohm'] - cand_feat['ohm']) > 5:
                    distinct_variants.append({
                        'reason': f"Different impedance ({keeper_feat['ohm']}Ω vs {cand_feat['ohm']}Ω)",
                        'keeper': keeper,
                        'cand': cand,
                        'rms': rms_gap,
                        'max': max_gap
                    })
                    continue
                    
            # Rule 2: Open vs Closed -> DO NOT MERGE!
            if (keeper_feat['is_closed'] != cand_feat['is_closed']) or (keeper_feat['is_open'] and cand_feat['is_closed']):
                distinct_variants.append({
                    'reason': "Open vs Closed enclosure",
                    'keeper': keeper,
                    'cand': cand,
                    'rms': rms_gap,
                    'max': max_gap
                })
                continue
                
            # Rule 3: Significant acoustic divergence (> 2.8 dB RMS) -> DISTINCT
            if rms_gap > 2.8:
                distinct_variants.append({
                    'reason': f"Significant acoustic divergence (RMS {rms_gap:.2f} dB)",
                    'keeper': keeper,
                    'cand': cand,
                    'rms': rms_gap,
                    'max': max_gap
                })
                continue
                
            # Rule 4: DUPLICATE (Exact / Redundant)
            # - Same clean name or sample/unit noise or rms < 0.6 dB
            is_exact_name = clean_brand_name(keeper['name']) == clean_brand_name(cand['name'])
            is_sample_duplicate = cand_feat['has_sample_noise'] or keeper_feat['has_sample_noise']
            
            if is_exact_name or (rms_gap < 0.6 and max_gap < 2.0) or (is_sample_duplicate and rms_gap < 1.2):
                duplicates.append({
                    'keeper': keeper,
                    'cand': cand,
                    'rms': rms_gap,
                    'max': max_gap,
                    'reason': 'Exact / identical measurement or sample duplicate'
                })
                continue
                
            # Rule 5: HIGHLY DUPLICATE
            # - Year revisions (2020 vs 2022 vs base) with rms < 2.0 dB
            # - Version/Gen (v1 vs v2, post-2020 earpads) with rms < 1.8 dB
            has_year_or_rev = (keeper_feat['year'] != cand_feat['year']) or (keeper_feat['revision'] != cand_feat['revision']) or ('earpads' in cand['name'].lower())
            if has_year_or_rev and rms_gap < 2.0:
                highly_duplicates.append({
                    'keeper': keeper,
                    'cand': cand,
                    'rms': rms_gap,
                    'max': max_gap,
                    'reason': f"Year / revision rolling update (RMS: {rms_gap:.2f} dB, Max: {max_gap:.2f} dB)"
                })
                continue
                
            # Rule 6: MAYBE DUPLICATE
            # - Same product family with rms between 1.5 dB and 2.8 dB
            if rms_gap <= 2.8:
                maybe_duplicates.append({
                    'keeper': keeper,
                    'cand': cand,
                    'rms': rms_gap,
                    'max': max_gap,
                    'reason': f"Noticeable tuning difference across runs/pads (RMS: {rms_gap:.2f} dB, Max: {max_gap:.2f} dB)"
                })
                
    return {
        'duplicates': duplicates,
        'highly_duplicates': highly_duplicates,
        'maybe_duplicates': maybe_duplicates,
        'distinct_variants': distinct_variants
    }

print("Running full analysis on headphones and IEMs...")
hp_res = analyze_dataset(ROOT / 'app/public/data/headphones.json', 'headphones')
iem_res = analyze_dataset(ROOT / 'app/public/data/iems.json', 'iems')

print("\n================== HEADPHONES ==================")
print(f"Duplicates (Exact / Redundant): {len(hp_res['duplicates'])}")
print(f"Highly Duplicate (Year / Rev updates): {len(hp_res['highly_duplicates'])}")
print(f"Maybe Duplicate (Tuning drift / Pads): {len(hp_res['maybe_duplicates'])}")
print(f"Distinct Variants (Kept separate - Ohms, Enclosure, etc.): {len(hp_res['distinct_variants'])}")

print("\n================== IEMS & TWS ==================")
print(f"Duplicates (Exact / Redundant): {len(iem_res['duplicates'])}")
print(f"Highly Duplicate (Year / Rev updates): {len(iem_res['highly_duplicates'])}")
print(f"Maybe Duplicate (Tuning drift / Tips): {len(iem_res['maybe_duplicates'])}")
print(f"Distinct Variants (Kept separate): {len(iem_res['distinct_variants'])}")

# Save report
out_data = {
    'headphones': {
        'duplicates': [{'cand': d['cand']['name'], 'cand_id': d['cand']['id'], 'keeper': d['keeper']['name'], 'keeper_id': d['keeper']['id'], 'rms': d['rms'], 'max': d['max'], 'reason': d['reason']} for d in hp_res['duplicates']],
        'highly_duplicates': [{'cand': d['cand']['name'], 'cand_id': d['cand']['id'], 'keeper': d['keeper']['name'], 'keeper_id': d['keeper']['id'], 'rms': d['rms'], 'max': d['max'], 'reason': d['reason']} for d in hp_res['highly_duplicates']],
        'maybe_duplicates': [{'cand': d['cand']['name'], 'cand_id': d['cand']['id'], 'keeper': d['keeper']['name'], 'keeper_id': d['keeper']['id'], 'rms': d['rms'], 'max': d['max'], 'reason': d['reason']} for d in hp_res['maybe_duplicates']],
    },
    'iems': {
        'duplicates': [{'cand': d['cand']['name'], 'cand_id': d['cand']['id'], 'keeper': d['keeper']['name'], 'keeper_id': d['keeper']['id'], 'rms': d['rms'], 'max': d['max'], 'reason': d['reason']} for d in iem_res['duplicates']],
        'highly_duplicates': [{'cand': d['cand']['name'], 'cand_id': d['cand']['id'], 'keeper': d['keeper']['name'], 'keeper_id': d['keeper']['id'], 'rms': d['rms'], 'max': d['max'], 'reason': d['reason']} for d in iem_res['highly_duplicates']],
        'maybe_duplicates': [{'cand': d['cand']['name'], 'cand_id': d['cand']['id'], 'keeper': d['keeper']['name'], 'keeper_id': d['keeper']['id'], 'rms': d['rms'], 'max': d['max'], 'reason': d['reason']} for d in iem_res['maybe_duplicates']],
    }
}

with open(ROOT / 'data/duplicates_audit.json', 'w', encoding='utf-8') as f:
    json.dump(out_data, f, indent=2, ensure_ascii=False)
print(f"\nSaved detailed audit to data/duplicates_audit.json")

