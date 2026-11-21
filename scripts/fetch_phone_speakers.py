"""Notebookcheck pink-noise bars per device (1/3-octave dB, unweighted per the 2026-11-20 report), from saved review pages.
Each chart is one <svg>: frequency labels sit under the bars at the same x as each series' value label."""
import json
import re
import sys
from pathlib import Path

d = Path(sys.argv[1])
out = {}
TEXT = re.compile(r'<text x="([\d.]+)" y="([\d.]+)"(?: class="(pn_\d+_\d)(?: hideEl)?")?\s*>([^<]*)</text>')
for f in sorted(d.glob('*.html')):
    s = f.read_text(encoding='utf-8', errors='replace')
    names = dict(re.findall(r"toggle_(\d+)_1'\)\.forEach\(element => \{element\.classList\.toggle\('hideEl'\)\}\);\">([^<]+)</text>", s))
    for chunk in s.split('<svg')[1:]:
        if 'class="pn_' not in chunk:
            continue
        texts = TEXT.findall(chunk)
        xhz = {}
        for x, y, cls, txt in texts:
            if cls:
                continue
            t = txt.strip().lower().replace('k', '000')
            if re.fullmatch(r'\d+(\.\d+)?', t):
                xhz[x] = float(t)
        series = {}
        for x, y, cls, txt in texts:
            if not cls or not cls.endswith('_1') or x not in xhz:
                continue  # _0 is the room noise
            try:
                series.setdefault(cls[3:-2], {})[xhz[x]] = float(txt)
            except ValueError:
                pass
        for sid, bars in series.items():
            name = names.get(sid, sid)
            if name not in out or len(bars) > len(out[name]):
                out[name] = {str(int(k)): v for k, v in sorted(bars.items())}
json.dump(out, open(d / 'pinknoise.json', 'w', encoding='utf-8'), indent=1)
for n, b in out.items():
    print(f"{n:30} {len(b):3} bands  1k={b.get('1000')}  100={b.get('100')}  4k={b.get('4000')}")
