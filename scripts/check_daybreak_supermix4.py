"""Inspect CrinEar Daybreak and Simgot SuperMix 4 in our iems.json and refs.json."""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import frcodec

def main():
    iems = json.loads((ROOT / "app/public/data/iems.json").read_text(encoding="utf-8"))
    refs = json.loads((ROOT / "app/public/data/refs.json").read_text(encoding="utf-8"))
    aliases = json.loads((ROOT / "app/public/data/aliases.json").read_text(encoding="utf-8"))
    grid = frcodec.decode_grid(iems["grid"])

    print(f"Grid points: {len(grid)}, range: {grid[0]:.1f} Hz .. {grid[-1]:.1f} Hz")

    for query in ["daybreak", "supermix 4", "supermix"]:
        print(f"\n=== Matching '{query}' in iems.json ===")
        for item in iems["items"]:
            if query in item["name"].lower() or query in item["id"].lower():
                vkeys = list(item.get("variants", {}).keys())
                print(f"  ID: {item['id']} | Name: {item['name']} | Default: {item.get('default')} | Variants ({len(vkeys)}): {vkeys[:10]}")
                in_refs = item["id"] in refs.get("refs", {})
                print(f"    In refs.json: {in_refs}")

        print(f"=== Matching '{query}' in aliases.json ===")
        for k, v in aliases.get("merge", {}).items():
            if query in k.lower() or query in v.lower():
                print(f"  Alias: {k} -> {v}")

if __name__ == "__main__":
    main()

