"""Phone and tablet loudspeakers as devices you listen on (plan §106 F) -> app/public/data/phone_speakers.json.

Source: Notebookcheck's pink-noise charts (1/3-octave bars, Earthworks M23R at ~15 cm, unweighted; see
reports/research-2026-11-20/phone_speaker_response.md), pulled by scripts/fetch_phone_speakers.py into
data/raw/notebookcheck/pinknoise.json. Each device is levelled to 0 dB at 1 kHz. Below 80 Hz the bars are room
noise, so the 125 -> 80 Hz trend is continued at 12 dB/oct; above 16 kHz the 12.5 -> 16 kHz slope goes on.
The three "typical" rows (both speakers, top only, bottom only) are the median phone; top-only and bottom-only
haven't been measured anywhere, so they share it until the two-phone session (§106 F3).

Usage: python -I scripts/build_phone_speakers.py
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data' / 'raw' / 'notebookcheck' / 'pinknoise.json'
GRID_FROM = ROOT / 'app' / 'public' / 'data' / 'speakers.json'
OUT = ROOT / 'app' / 'public' / 'data' / 'phone_speakers.json'

# Notebookcheck name -> (id, shown name, Android Build.MODEL prefixes, tablet)
MODELS = {
    'Xiaomi 14': ('xiaomi-14', 'Xiaomi 14', ['23127PN0C'], False),
    'Xiaomi 14 Pro': ('xiaomi-14-pro', 'Xiaomi 14 Pro', ['23116PN5B'], False),
    'Xiaomi 14 Ultra': ('xiaomi-14-ultra', 'Xiaomi 14 Ultra', ['24030PN60', '24031PN0D'], False),
    'Xiaomi 13 Pro': ('xiaomi-13-pro', 'Xiaomi 13 Pro', ['2210132'], False),
    'Xiaomi 11T Pro': ('xiaomi-11t-pro', 'Xiaomi 11T Pro', ['2107113S'], False),
    'Samsung Galaxy S21 FE 5G': ('galaxy-s21-fe', 'Galaxy S21 FE', ['SM-G990'], False),
    'Samsung Galaxy S23': ('galaxy-s23', 'Galaxy S23', ['SM-S911'], False),
    'Samsung Galaxy S24 Ultra': ('galaxy-s24-ultra', 'Galaxy S24 Ultra', ['SM-S928'], False),
    'Samsung Galaxy Tab S9 5G': ('galaxy-tab-s9', 'Galaxy Tab S9', ['SM-X71'], True),
    'Samsung Galaxy Tab S8 5G': ('galaxy-tab-s8', 'Galaxy Tab S8', ['SM-X70'], True),
    'Samsung Galaxy Tab S9 FE': ('galaxy-tab-s9-fe', 'Galaxy Tab S9 FE', ['SM-X51'], True),
}
# the median phone from the 2026-11-20 report (also in app/src/shell/sound/phoneSpeaker.ts)
TYPICAL_HZ = [20, 40, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1600, 2000, 2500, 3150, 4000, 5000, 8000, 10000, 12500, 16000, 20000]
TYPICAL_DB = [-60, -52, -42, -36, -32, -23, -22, -19, -17, -15, -9, -8, -4, 0, 0, 3, 4, 6, 6, 3.5, 0, 0, -9, -14, -20]


def curve(hz: list[float], db: list[float], grid: np.ndarray) -> list[float]:
    """Onto the grid (log-frequency interpolation), smoothed to a third of an octave: single bars jump ±2-4 dB."""
    y = np.interp(np.log2(grid), np.log2(hz), db)
    ppo = round(1 / np.log2(grid[1] / grid[0]))
    half = max(1, round(ppo / 6))
    k = np.ones(2 * half + 1) / (2 * half + 1)
    sm = np.convolve(np.pad(y, half, mode='edge'), k, mode='valid')
    return [round(float(v), 1) for v in sm]


def measured(bars: dict[str, float]) -> tuple[list[float], list[float]]:
    hz = sorted(float(k) for k in bars)
    db = [bars[str(int(h))] - bars['1000'] for h in hz]
    pts = [(h, d) for h, d in zip(hz, db) if h >= 80]
    h80, d80 = pts[0]
    lo = [(f, d80 - 12 * np.log2(h80 / f)) for f in (20, 40)]  # 12 dB/oct down from the first real bar
    (h12, d12), (h16, d16) = next(p for p in pts if p[0] == 12500), pts[-1]
    hi = [(20000, d16 + (d16 - d12) / np.log2(h16 / h12) * np.log2(20000 / h16))]
    allp = lo + pts + hi
    return [p[0] for p in allp], [round(float(p[1]), 1) for p in allp]


def main():
    grid = np.array(json.loads(GRID_FROM.read_text(encoding='utf-8'))['grid'])
    raw = json.loads(RAW.read_text(encoding='utf-8'))
    typical = curve(TYPICAL_HZ, TYPICAL_DB, grid)
    rows = [
        {'id': 'phone-speaker-both', 'name': 'Phone speakers', 'models': [], 'tablet': False, 'fr': typical,
         'source': 'This phone if measured, else the median of 8 phones (Notebookcheck pink noise)'},
        {'id': 'phone-speaker-top', 'name': 'Phone speaker (top only)', 'models': [], 'tablet': False, 'fr': typical,
         'source': 'Median of 8 phones (top only not measured yet)'},
        {'id': 'phone-speaker-bottom', 'name': 'Phone speaker (bottom only)', 'models': [], 'tablet': False, 'fr': typical,
         'source': 'Median of 8 phones (bottom only not measured yet)'},
    ]
    for nb_name, (sid, name, models, tablet) in MODELS.items():
        if nb_name not in raw:
            print('missing', nb_name)
            continue
        hz, db = measured(raw[nb_name])
        rows.append({'id': f'phone-speaker-{sid}', 'name': f'{name} speakers', 'models': models, 'tablet': tablet,
                     'fr': curve(hz, db, grid), 'source': 'Notebookcheck pink noise (both speakers)'})
    OUT.write_text(json.dumps({
        'note': 'Phone and tablet loudspeakers, dB against 1 kHz (scripts/build_phone_speakers.py, plan §106 F).',
        'grid': [round(float(f), 2) for f in grid],
        'speakers': rows,
    }, separators=(',', ':')), encoding='utf-8')
    print(f'{len(rows)} rows -> {OUT}')
    at = lambda r, f: r['fr'][int(np.argmin(abs(grid - f)))]
    for r in rows:
        print(f"  {r['name']:42} 100 Hz {at(r, 100):6}  4 kHz {at(r, 4000):5}  16 kHz {at(r, 16000):6}")


if __name__ == '__main__':
    main()
