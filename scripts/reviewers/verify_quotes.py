"""Re-check every quote in data/reviewers/*.json verbatim against the saved raw source.

Only whitespace is normalised (HTML: tags removed, entities decoded; CSV: cells parsed).
Sets quoteVerified per entry; entries that fail are dropped unless --keep is given.
Usage: verify_quotes.py [--keep]
"""
import csv, html, io, json, re, sys, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/reviewers"
sys.stdout.reconfigure(encoding="utf-8")


def ws(s):
    return re.sub(r"\s+", " ", s).strip()


def html_text(p):
    s = p.read_text(encoding="utf-8", errors="replace")
    s = re.sub(r"<script.*?</script>|<style.*?</style>", " ", s, flags=re.S | re.I)
    return ws(html.unescape(re.sub(r"<[^>]+>", " ", s)))


def csv_text(p):
    rows = csv.reader(io.StringIO(p.read_text(encoding="utf-8")))
    return " | ".join(ws(c) for r in rows for c in r)


_cache = {}


def source_text(slug, url):
    if slug == "precogvision":
        p = RAW / "precogvision/rankings.html"
    elif slug == "rikudou-goku":
        p = RAW / "rikudou-goku/iem_ranking.csv"
    elif slug == "antdroid":
        p = RAW / "antdroid/reviews" / urllib.parse.urlparse(url).path.strip("/").replace("/", "_")
    else:
        raise SystemExit(f"no raw source mapping for {slug}")
    if p not in _cache:
        _cache[p] = (csv_text if p.suffix == ".csv" else html_text)(p) if p.exists() else ""
    return _cache[p]


keep = "--keep" in sys.argv
for f in sorted((ROOT / "data/reviewers").glob("*.json")):
    d = json.loads(f.read_text(encoding="utf-8"))
    ok, bad = [], []
    for e in d["entries"]:
        q = ws(html.unescape(e["quote"] or ""))
        e["quoteVerified"] = bool(q) and len(q) <= 320 and q in source_text(f.stem, e["url"])
        (ok if e["quoteVerified"] else bad).append(e)
    for e in bad:
        print(f"  FAIL {f.stem}: {e['rawName']}: {e['quote'][:80]!r}")
    d["entries"] = ok + bad if keep else ok
    f.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{f.stem}: {len(ok)} verified, {len(bad)} failed ({'kept, flagged' if keep else 'dropped'})")
