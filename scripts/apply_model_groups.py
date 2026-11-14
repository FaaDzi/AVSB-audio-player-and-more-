"""Add the reviewed groups in scripts/model_groups_2026_11.json to app/public/data/aliases.json.

families make the rest of a name a config of one model, so no measurement is lost. merges say two
rows are the same model and config. Indexes point at data/dup_candidates_*.json, so ids are looked up
once and written to scripts/model_group_merges.json, and a later finder run can't change what they mean.

Usage: python -I scripts/apply_model_groups.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ALIASES = ROOT.parent / "app" / "public" / "data" / "aliases.json"
GROUPS = json.loads((ROOT / "model_groups_2026_11.json").read_text(encoding="utf-8"))
LOCKED = ROOT / "model_group_merges.json"


def merge_ids():
    if LOCKED.exists():
        return json.loads(LOCKED.read_text(encoding="utf-8"))
    pairs = {}
    for kind, index, keep in GROUPS["merges"]:
        rows = json.loads((ROOT.parent / "data" / f"dup_candidates_{kind}.json").read_text(encoding="utf-8"))
        row = rows[index]
        kept, gone = (row["idA"], row["idB"]) if keep == "a" else (row["idB"], row["idA"])
        pairs[gone] = kept
        print(f"merge {row['b' if keep == 'a' else 'a']!r} into {row['a' if keep == 'a' else 'b']!r}")
    LOCKED.write_text(json.dumps(pairs, ensure_ascii=False, indent=1), encoding="utf-8")
    return pairs


aliases = json.loads(ALIASES.read_text(encoding="utf-8"))
before = (len(aliases["families"]), len(aliases["merge"]))
aliases["families"].update(GROUPS["families"])
aliases["merge"].update(merge_ids())
with open(ALIASES, "w", encoding="utf-8", newline="\r\n") as f:
    json.dump(aliases, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"families {before[0]} -> {len(aliases['families'])}, merges {before[1]} -> {len(aliases['merge'])}")
