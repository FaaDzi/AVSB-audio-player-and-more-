"""Re-check every quote in data/reviewers/*.json (YouTube sources) verbatim against the
caption text in data/raw/reviewers/<slug>/subs/<id>.txt, and that the &t= timestamp
is the caption line where the quote starts. Prints failures; exit code 1 if any.

Usage: .venv/Scripts/python -I scripts/verify_reviewer_quotes.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8")
fails = total = 0
for f in sorted((ROOT / "data/reviewers").glob("*.json")):
    d = json.load(open(f, encoding="utf-8"))
    if d.get("sourceType") != "youtube":
        continue
    subs = ROOT / "data/raw/reviewers" / f.stem / "subs"
    for e in d["entries"]:
        total += 1
        m = re.search(r"[?&]v=([\w-]{11})&t=(\d+)s", e["url"])
        vid, sec = m[1], int(m[2])
        text, starts = "", []
        for ln in open(subs / f"{vid}.txt", encoding="utf-8"):
            mm = re.match(r"\[(\d+):(\d+)\] (.*)", ln.rstrip("\n"))
            starts.append((len(text) + (1 if text else 0), int(mm[1]) * 60 + int(mm[2])))
            text += (" " if text else "") + mm[3]
        i = text.find(e["quote"])
        problem = None
        if i < 0:
            problem = "quote not found verbatim"
        elif [t for off, t in starts if off <= i][-1] != sec:
            problem = "timestamp mismatch"
        elif not e.get("quoteVerified"):
            problem = "quoteVerified flag is false"
        if problem:
            fails += 1
            print(f"FAIL {f.stem} {e['name']}: {problem}: {e['quote'][:80]!r}")
print(f"checked {total} quotes, {fails} failed")
sys.exit(1 if fails else 0)
