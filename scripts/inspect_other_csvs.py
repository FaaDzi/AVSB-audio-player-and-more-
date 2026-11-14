import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

for name in ["goldensound", "listener", "hps"]:
    p = Path(f"data/raw/{name}_headphones.csv")
    if p.exists():
        lines = p.read_text(encoding='utf-8-sig').strip().split('\n')
        print(f"\n--- {name.upper()} ({len(lines)} lines) ---")
        print("Header:", lines[0])
        for l in lines[1:4]:
            print("  ", l[:120])

