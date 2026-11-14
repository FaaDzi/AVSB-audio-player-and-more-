"""Build data/reviewers/<slug>.json for YouTube reviewers from hand-collected entries
(scripts/reviewer_entries_<slug>.py, module-level ENTRIES list).

Entry tuple: (videoId, name, rawName, nameConfidence, grade, verdict, quote)

Quotes must appear verbatim in the de-duplicated captions
(data/raw/reviewers/<slug>/subs/<id>.txt, caption lines joined by spaces); the
timestamp is the caption line where the quote starts.  Failures are flagged, not
silently dropped (quoteVerified=false).

Usage: .venv/Scripts/python -I scripts/build_reviewers_youtube.py [slug ...]
"""
import importlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from names import base, key  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
ACCESSED = "2026-10-16"

REVIEWERS = {
    "gizaudio": {"reviewer": "Gizaudio", "sourceUrl": "https://www.youtube.com/@Gizaudio", "gradeScale": None},
    "super-review": {"reviewer": "Super* Review", "sourceUrl": "https://www.youtube.com/@SuperReview",
                     "gradeScale": None},
    "hawaii-bad-boy": {"reviewer": "Hawaii Bad Boy (Bad Guy Good Audio Reviews)",
                       "sourceUrl": "https://www.youtube.com/@BadGuyGoodAudioReviews", "gradeScale": None},
}

CATALOG = json.load(open(ROOT / "app/public/data/iems.json", encoding="utf-8"))["iems"]
CAT_KEYS = {}
for it in CATALOG:
    CAT_KEYS.setdefault(key(it["name"]), it["name"])
    CAT_KEYS.setdefault(key(base(it["name"])), it["name"])


def load_captions(subs, vid):
    text, starts = "", []
    for ln in open(subs / f"{vid}.txt", encoding="utf-8"):
        m = re.match(r"\[(\d+):(\d+)\] (.*)", ln.rstrip("\n"))
        if text:
            text += " "
        starts.append((len(text), int(m[1]) * 60 + int(m[2])))
        text += m[3]
    return text, starts


def load_meta(raw):
    meta = {}
    for ln in open(raw / "meta.txt", encoding="utf-8"):
        vid, date, dur, title = ln.rstrip("\n").split("|", 3)
        meta[vid] = {"uploadDate": f"{date[:4]}-{date[4:6]}-{date[6:]}" if re.fullmatch(r"\d{8}", date) else None,
                     "title": title}
    return meta


def build(slug):
    raw = ROOT / "data/raw/reviewers" / slug
    subs = raw / "subs"
    meta = load_meta(raw)
    entries_src = importlib.import_module("reviewer_entries_" + slug.replace("-", "_")).ENTRIES
    caps = {}
    entries, problems = [], []
    for vid, name, raw_name, conf, grade, verdict, quote in entries_src:
        if vid not in caps:
            caps[vid] = load_captions(subs, vid)
        text, starts = caps[vid]
        i = text.find(quote)
        ok = i >= 0
        sec = [t for off, t in starts if off <= i][-1] if ok else 0
        if not ok:
            problems.append(f"QUOTE NOT FOUND {vid}: {quote[:70]!r}")
        if len(quote) > 320:
            problems.append(f"long quote ({len(quote)}): {name}")
        cat = CAT_KEYS.get(key(name))
        entries.append({
            "name": name, "rawName": raw_name, "nameConfidence": conf, "inCatalog": cat is not None,
            "grade": grade, "verdict": verdict, "quote": quote, "quoteVerified": ok,
            "url": f"https://www.youtube.com/watch?v={vid}&t={sec}s",
            "timestamp": f"{sec // 60}:{sec % 60:02d}", "videoTitle": meta[vid]["title"],
        })
    used = list(dict.fromkeys(e[0] for e in entries_src))
    picked = [ln.strip() for ln in open(raw / "picked.txt") if ln.strip()]
    videos = [{"id": v, "title": meta[v]["title"], "url": f"https://www.youtube.com/watch?v={v}",
               "uploadDate": meta[v]["uploadDate"], "entryCount": sum(1 for e in entries_src if e[0] == v)}
              for v in picked if v in meta and (subs / f"{v}.txt").exists()]
    videos.sort(key=lambda v: v["uploadDate"] or "", reverse=True)
    out = {**REVIEWERS[slug], "sourceType": "youtube", "accessed": ACCESSED,
           "method": "English auto-captions via yt-dlp (subtitles only); quotes verbatim from caption text; "
                     "names resolved against app/public/data/iems.json with scripts/names.py key()",
           "videos": videos, "entries": entries}
    out = {k: out[k] for k in ["reviewer", "sourceType", "sourceUrl", "accessed", "gradeScale", "method",
                               "videos", "entries"]}
    dest = ROOT / "data/reviewers" / f"{slug}.json"
    dest.parent.mkdir(exist_ok=True)
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    by_conf = {c: sum(1 for e in entries if e["nameConfidence"] == c) for c in ("high", "medium", "low")}
    print(f"{slug}: videos {len(videos)} (with entries {len(used)})  entries {len(entries)} {by_conf}  "
          f"inCatalog {sum(e['inCatalog'] for e in entries)}")
    for p in problems:
        print("  WARN", p)


for s in sys.argv[1:] or REVIEWERS:
    build(s)
