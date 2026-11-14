"""Speakers and soundbars as "what you listen on" (plan §78 B) -> app/public/data/speakers.json, plus the generic
speaker and soundbar presets (§78 C) into app/public/data/generic.json.

Data: spinorama.org (CEA-2034 measurements from ASR, Erin's Audio Corner, vendors and others), licence
CC BY-NC-SA 4.0. Its API now wants a key, so this reads the site's own static files: json/metadata.json and each
speaker's "Estimated In-Room Response" plot data. Both are cached in data/raw/spinorama/; delete a file to refetch.

Kept (desktop first, plan §79 I): every active (powered) bookshelf speaker or monitor, passive bookshelf speakers up to
$500 each (named "(passive)": they need an amp), and the one measured soundbar. Each gets spinorama's picture as a
small WebP in app/public/img/spk/. Curves are the estimated
in-room response put on the app's grid, levelled to 0 dB over 300 Hz-3 kHz. Credit is kept per measurement.

Run from the repo root: python scripts/build_speakers.py
"""
import base64
import json
import math
import statistics
import struct
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data' / 'raw' / 'spinorama'
DATA = ROOT / 'app' / 'public' / 'data'
SITE = 'https://www.spinorama.org'
MAX_PASSIVE_EACH_USD = 500
IMG = ROOT / 'app' / 'public' / 'img' / 'spk'
GENERIC_PAIR_USD = 100  # owner to confirm the cut (plan §78 C)
SHAPES = {'bookshelves', 'soundbar'}


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def fetch(url, dest):
    if not dest.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'AVSB data builder'})
        with urllib.request.urlopen(req, timeout=60) as r:
            dest.write_bytes(r.read())
    return load(dest)


def arr(v):
    """Plotly stores arrays as lists or as {'dtype': 'f8', 'bdata': base64}."""
    if isinstance(v, list):
        return v
    raw = base64.b64decode(v['bdata'])
    fmt = {'f8': 'd', 'f4': 'f'}[v['dtype']]
    n = len(raw) // struct.calcsize(fmt)
    return list(struct.unpack(f'<{n}{fmt}', raw))


def on_grid(xs, ys, grid):
    """Linear in log-frequency; held flat past the measured ends."""
    pts = sorted(zip(xs, ys))
    out = []
    j = 0
    for f in grid:
        if f <= pts[0][0]:
            out.append(pts[0][1])
            continue
        if f >= pts[-1][0]:
            out.append(pts[-1][1])
            continue
        while pts[j + 1][0] < f:
            j += 1
        (x0, y0), (x1, y1) = pts[j], pts[j + 1]
        t = (math.log(f) - math.log(x0)) / (math.log(x1) - math.log(x0))
        out.append(y0 + t * (y1 - y0))
    return out


def level(curve, grid):
    mid = [v for f, v in zip(grid, curve) if 300 <= f <= 3000]
    m = sum(mid) / len(mid)
    return [round(v - m, 1) for v in curve]


def price_each(v):
    try:
        p = float(v.get('price') or 'nan')
    except ValueError:
        return None
    if p != p:
        return None
    return p / 2 if v.get('amount') == 'pair' else p


def picture(name, sid):
    """spinorama's picture of the speaker as a small WebP (max 200 px); None when it has none."""
    from PIL import Image
    out = IMG / f'{sid}.webp'
    if not out.exists():
        IMG.mkdir(parents=True, exist_ok=True)
        cache = RAW / 'pictures'
        cache.mkdir(exist_ok=True)
        raw = None
        for ext in ('webp', 'jpg', 'png'):
            dest = cache / f'{sid}.{ext}'
            if dest.exists():
                raw = dest
                break
            try:
                req = urllib.request.Request(f'{SITE}/pictures/{urllib.parse.quote(name)}.{ext}', headers={'User-Agent': 'AVSB data builder'})
                with urllib.request.urlopen(req, timeout=60) as r:
                    dest.write_bytes(r.read())
                raw = dest
                break
            except Exception:  # noqa: BLE001 - try the next format
                continue
        if raw is None:
            return None
        im = Image.open(raw).convert('RGBA')
        im.thumbnail((200, 200))
        im.save(out, 'WEBP', quality=80)
    return f'img/spk/{sid}.webp'


def slug(name):
    return 'spk-' + ''.join(c if c.isalnum() else '-' for c in name.lower()).strip('-').replace('--', '-')


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    meta = fetch(f'{SITE}/json/metadata.json', RAW / 'metadata.json')
    grid = load(DATA / 'iems.json')['grid']

    speakers = []
    for name, v in sorted(meta.items()):
        each = price_each(v)
        shape, kind = v.get('shape'), v.get('type')
        # powered speakers at any price; passive ones (need an amp) up to $500 each; the one measured soundbar
        passive = kind == 'passive' and shape == 'bookshelves' and each is not None and each <= MAX_PASSIVE_EACH_USD
        if not (passive or (kind == 'active' and shape in SHAPES)):
            continue
        key = v['default_measurement']
        m = v['measurements'][key]
        url = f"{SITE}/speakers/{urllib.parse.quote(name)}/{urllib.parse.quote(m['origin'])}/{urllib.parse.quote(key)}/Estimated%20In-Room%20Response.json"
        try:
            plot = fetch(url, RAW / f'{slug(name)}.pir.json')
        except Exception as e:  # noqa: BLE001 - one missing plot shouldn't stop the rest
            print(f'skip {name}: {e}')
            continue
        trace = next((t for t in plot['data'] if t.get('name') == 'Estimated In-Room Response'), None)
        if not trace:
            print(f'skip {name}: no in-room trace')
            continue
        curve = level(on_grid(arr(trace['x']), arr(trace['y']), grid), grid)
        full = f"{v['brand']} {v['model']}" if not name.startswith(v['brand']) else name
        speakers.append({
            'id': slug(name),
            'name': f'{full} (passive)' if passive else full,
            'passive': passive,
            'photo': picture(name, slug(name)),
            'kind': 'soundbar' if v['shape'] == 'soundbar' else 'speakers',
            'priceUsdEach': each,
            'pairUsd': None if each is None else each * (1 if v['shape'] == 'soundbar' or v.get('amount') is None else 2),
            'source': f"{m['origin']} via spinorama.org",
            'review': m.get('review') or None,
            'fr': curve,
        })

    out = {
        'note': 'Estimated in-room responses from spinorama.org (CC BY-NC-SA 4.0), levelled over 300 Hz-3 kHz (scripts/build_speakers.py, plan §78 B).',
        'licence': 'CC BY-NC-SA 4.0, https://www.spinorama.org',
        'grid': grid,
        'speakers': speakers,
    }
    with open(DATA / 'speakers.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    # generic presets: median of the budget pairs; the soundbar is the one measured bar with the budget speakers' bass
    budget = [s['fr'] for s in speakers if s['kind'] == 'speakers' and not s['passive'] and s['pairUsd'] is not None and s['pairUsd'] <= GENERIC_PAIR_USD]
    generic_spk = [round(statistics.median(col), 1) for col in zip(*budget)]
    bar = next((s for s in speakers if s['kind'] == 'soundbar'), None)
    generic = load(DATA / 'generic.json') if (DATA / 'generic.json').exists() else {'grid': grid, 'devices': []}
    devices = [d for d in generic['devices'] if d['kind'] not in ('speakers', 'soundbar')]
    devices.append({'id': 'spk-generic', 'name': f'Generic speakers (≤ ${GENERIC_PAIR_USD} a pair)', 'kind': 'speakers', 'count': len(budget), 'fr': generic_spk})
    if bar:
        # below 200 Hz the bar's own (deep for its size) bass gives way to the budget speakers' roll-off, joined at 200 Hz
        k = min(range(len(grid)), key=lambda i: abs(grid[i] - 200))
        shift = bar['fr'][k] - generic_spk[k]
        rough = [round(generic_spk[i] + shift, 1) if f < 200 else bar['fr'][i] for i, f in enumerate(grid)]
        devices.append({'id': 'spk-generic-soundbar', 'name': 'Generic soundbar (rough)', 'kind': 'soundbar', 'count': 1, 'rough': True, 'fr': rough})
    generic['devices'] = devices
    generic['grid'] = grid
    with open(DATA / 'generic.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(generic, f, ensure_ascii=False, separators=(',', ':'))

    for s in speakers:
        print(f"{s['kind']:9} ${s['pairUsd'] or 0:>6.0f}  {'photo' if s['photo'] else '-    '}  {s['name']}  ({s['source']})")
    print(f'{len(speakers)} kept; generic speakers from {len(budget)} pairs <= ${GENERIC_PAIR_USD}')


if __name__ == '__main__':
    main()
