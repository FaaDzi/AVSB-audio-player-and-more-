"""Generic presets for no-name gear (plan §78 C) -> app/public/data/generic.json.

One curve per kind, the median of measured budget devices, each levelled at 1 kHz first (median, so one odd device
doesn't skew it):
  Generic IEM (<= $50)        wired in-ears with a Jay's-sheet or shop price
  Generic headphones (<= $50) the same, headphone list
  Generic TWS (<= Rp 800k)    Fernanda Gunsan's IDR prices pick the budget buds (shop prices barely cover TWS)
Speakers and the soundbar come from build_speakers.py (they need the spinorama data).

Run from the repo root: python scripts/build_generic_presets.py
"""
import base64
import json
import re
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'app' / 'public' / 'data'
OUT = DATA / 'generic.json'
IEM_USD = 50
HP_USD = 50
TWS_IDR = 800_000


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def decode_fr(packed, scale):
    """The app's packed curve (src/audio/data.ts decodeFrInto) -> dB list."""
    steps = packed.startswith('~')
    b = base64.b64decode(packed[1:] if steps else packed)
    if not steps:
        vals = [int.from_bytes(b[2 * i:2 * i + 2], 'little', signed=True) for i in range(len(b) // 2)]
    else:
        vals = [int.from_bytes(b[0:2], 'little', signed=True)]
        for i in range(2, len(b)):
            d = b[i] - 256 if b[i] > 127 else b[i]
            vals.append(vals[-1] + d)
    return [v * scale for v in vals]


def wireless_regex():
    """The app's own TWS name test (src/audio/wireless.ts), so both agree."""
    src = (ROOT / 'app' / 'src' / 'audio' / 'wireless.ts').read_text(encoding='utf-8')
    tips = re.search(r'const EARTIP_TWS =\s*/(.*)/gi', src).group(1)
    wl = re.search(r'const WIRELESS =\s*/(.*)/i\n', src).group(1)
    return re.compile(tips, re.I), re.compile(wl, re.I)


TIPS, WIRELESS = wireless_regex()


def is_wireless(name):
    return bool(WIRELESS.search(TIPS.sub(' ', name)))


def median_curve(curves, grid):
    k = min(range(len(grid)), key=lambda i: abs(grid[i] - 1000))
    levelled = [[v - c[k] for v in c] for c in curves]
    return [round(statistics.median(col), 1) for col in zip(*levelled)]


def main():
    reviews = load(DATA / 'reviews.json')
    shop = load(DATA / 'prices.json')

    def usd(i):
        for r in reviews['reviews'].get(i, []):
            p = (r.get('jay') or {}).get('priceUsd')
            if p is not None:
                return p
        s = shop.get(i)
        return s['usd'] if s else None

    # Fernanda's comments carry his original text; his sheet carries the IDR price
    kitab = load(ROOT / 'data' / 'kitab.json')['entries']
    idr_by_text = {e['review'].strip(): e['priceIdr'] for e in kitab if e.get('priceIdr') and e.get('review') and e.get('kind') == 'tws'}
    idr = {}
    for cid, cms in reviews['comments'].items():
        for c in cms:
            if c.get('reviewer') == 'Fernanda Gunsan' and (c.get('original') or '').strip() in idr_by_text:
                idr[cid] = idr_by_text[c['original'].strip()]

    iems = load(DATA / 'iems.json')
    hps = load(DATA / 'headphones.json')
    grid = iems['grid']
    assert hps['grid'] == grid

    picks = {'iem': [], 'tws': [], 'hp': []}
    for d in iems['iems']:
        fr = decode_fr(d['fr'], iems['frScale'])
        if is_wireless(d['name']) or d['id'] in idr:
            if d['id'] in idr and idr[d['id']] <= TWS_IDR:
                picks['tws'].append(fr)
        else:
            p = usd(d['id'])
            if p is not None and p <= IEM_USD:
                picks['iem'].append(fr)
    for d in hps['iems']:
        p = usd(d['id'])
        if p is not None and p <= HP_USD:
            picks['hp'].append(decode_fr(d['fr'], hps['frScale']))

    devices = [
        {'id': 'generic-iem', 'name': f'Generic IEM (≤ ${IEM_USD})', 'kind': 'iems', 'count': len(picks['iem']), 'fr': median_curve(picks['iem'], grid)},
        {'id': 'generic-tws', 'name': 'Generic TWS earbuds (≤ Rp 800k)', 'kind': 'tws', 'count': len(picks['tws']), 'fr': median_curve(picks['tws'], grid)},
        {'id': 'hp-generic', 'name': f'Generic headphones (≤ ${HP_USD})', 'kind': 'headphones', 'count': len(picks['hp']), 'fr': median_curve(picks['hp'], grid)},
    ]
    old = load(OUT) if OUT.exists() else {}
    keep = [d for d in old.get('devices', []) if d['kind'] in ('speakers', 'soundbar')]
    out = {'note': 'Median of measured budget devices, levelled at 1 kHz (scripts/build_generic_presets.py, plan §78 C).',
           'grid': grid, 'devices': devices + keep}
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    for d in devices:
        print(f"{d['name']}: median of {d['count']}")
    print(f'{len(idr)} TWS priced from Fernanda Gunsan; wrote {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
