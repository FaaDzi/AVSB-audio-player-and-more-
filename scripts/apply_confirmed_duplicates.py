"""Add reviewed duplicates (scripts/duplicates_confirmed.json: duplicate id -> kept id) to
app/public/data/aliases.json, on top of what's there. The app reads aliases.json for the IEM/TWS
catalog and the headphone catalog alike, so hp- ids work too.

A merged model's leftover variants follow it: once "AFUL Performer 7" is the 5+2, the row
"AFUL Performer 7 (5+2)" goes there too, or its model name would come back in the list.
Chains (a -> b -> c) are followed so every duplicate points at a kept row. Safe to re-run.

Candidates come from scripts/find_duplicate_candidates.py; a person or reviewer confirms them.

Usage: python -I scripts/apply_confirmed_duplicates.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from names import base, key  # noqa: E402

COLLAB = r"\s+[x×]\s+(crinacle|hbb|hawaiibadboy|gizaudio|z ?reviews?|super ?review|jays? ?audio)\b"
SUFFIX = r"^(\S+)\s+(acoustics?|audio|ears?|hifi)\b"

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "public" / "data"
ALIASES = DATA / "aliases.json"
CONFIRMED = ROOT / "scripts" / "duplicates_confirmed.json"


def main():
    aliases = json.loads(ALIASES.read_text(encoding="utf-8"))
    merge = aliases["merge"]
    before = len(merge)
    rows = json.loads((DATA / "iems.json").read_text(encoding="utf-8"))["iems"]
    rows += json.loads((DATA / "headphones.json").read_text(encoding="utf-8"))["iems"]
    ids = {r["id"] for r in rows}
    entries = {k: v for k, v in json.loads(CONFIRMED.read_text(encoding="utf-8")).items() if not k.startswith("_")}
    # null = a wrong merge to undo: that row is its own model again
    unmerge = [k for k, v in entries.items() if v is None]
    confirmed = {k: v for k, v in entries.items() if v is not None}
    bad = [(d, k) for d, k in confirmed.items() if d not in ids or k not in ids or d == k] + [(d, None) for d in unmerge if d not in ids]
    if bad:
        sys.exit(f"ids not found / self-merge: {bad}")
    for d in unmerge:
        merge.pop(d, None)
    merge.update(confirmed)

    # variants of a merged model follow it (any merge, not just the new ones; names compared
    # case-blind: "Aful Performer 7 (5+2)" belongs to the merged "AFUL Performer 7")
    by_id = {r["id"]: r for r in rows}
    fold = lambda n: base(n).lower()
    # the app's own tidy (app/src/data/tidy.ts) already groups names that differ only by a collab
    # tag or brand suffix ("Truthear Zero" / "Truthear x Crinacle Zero"); moving those rows would
    # only change which spelling the model shows under
    plain = lambda n: key(re.sub(COLLAB, " ", re.sub(SUFFIX, r"\1", n)))
    same = lambda a, b: plain(a) == plain(b)
    target_of_base = {fold(by_id[d]["name"]): k for d, k in merge.items() if d in by_id and k in by_id and base(by_id[d]["name"]) == by_id[d]["name"]}
    followed = 0
    for r in rows:
        b = fold(r["name"])
        t = target_of_base.get(b)
        if r["id"] in merge or b == r["name"].lower() or not t or t == r["id"] or same(fold(by_id[t]["name"]), b) or r["id"] in unmerge:
            continue
        merge[r["id"]] = t
        followed += 1

    for d in list(merge):
        seen = {d}
        while merge[d] in merge and merge[d] not in seen:
            seen.add(merge[d])
            merge[d] = merge[merge[d]]
        if merge[d] == d:
            del merge[d]  # a cycle collapsed onto itself: keep the row

    # the file's own format (2-space indent, CRLF), so a re-run only shows real changes
    text = json.dumps(aliases, ensure_ascii=False, indent=2).replace("\n", "\r\n")
    ALIASES.write_bytes(text.encode("utf-8"))
    print(f"{len(confirmed)} confirmed, {followed} variants followed; merges {before} -> {len(merge)}")


if __name__ == "__main__":
    main()
