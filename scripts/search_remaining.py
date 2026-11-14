import json
from pathlib import Path

targets = ['juzear', 'penon', 'raptgo', 'audiosense']
for p in Path('data/raw/stores').glob('*.json'):
    try:
        prods = json.loads(p.read_text(encoding='utf-8'))
        for x in prods:
            t = (x.get('title', '') + ' ' + x.get('handle', '')).lower()
            for b in targets:
                if b in t:
                    title = x.get('title')
                    print(f"[{b}] in {p.stem}: {title}")
    except Exception:
        pass
