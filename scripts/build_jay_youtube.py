"""Build data/jay_youtube.json from hand-collected entries (scripts/jay_youtube_entries.py).

Every quote must appear verbatim in the de-duplicated captions
(data/raw/jay/youtube/subs/<id>.txt, lines joined by spaces); the timestamp is
the caption line where the quote starts.

Usage: .venv/Scripts/python -I scripts/build_jay_youtube.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import importlib  # noqa: E402

NOT_ON_SHEET, CONFLICTS = [], []
for mod_path in sorted((ROOT / "scripts").glob("jay_youtube_entries*.py")):
    mod = importlib.import_module(mod_path.stem)
    NOT_ON_SHEET += mod.NOT_ON_SHEET
    CONFLICTS += mod.CONFLICTS

SUBS = ROOT / "data/raw/jay/youtube/subs"
VIDEOS = {v["id"]: v for v in json.load(open(ROOT / "data/raw/jay/youtube/videos.json", encoding="utf-8"))["videos"]}
SHEET = json.load(open(ROOT / "data/jay_rankings.json", encoding="utf-8"))

PICKED = sorted({p.stem for p in SUBS.glob("*.txt")})


def norm(s):
    s = s.lower().replace("letshuoer", "shuoer").replace("mkii", "mk2").replace("mk ii", "mk2")
    s = s.replace("mark ii", "mk2").replace("mk i", "mk1").replace("kiwiears", "kiwi ears")
    return re.sub(r"[^a-z0-9]", "", s)


SHEET_NORM = {norm(s["name"]): s for s in SHEET}

captions = {}
for vid in PICKED:
    text, starts = "", []
    for ln in open(SUBS / f"{vid}.txt", encoding="utf-8"):
        m = re.match(r"\[(\d+):(\d+)\] (.*)", ln.rstrip("\n"))
        if text:
            text += " "
        starts.append((len(text), int(m[1]) * 60 + int(m[2])))
        text += m[3]
    captions[vid] = (text, starts)


def locate(vid, quote):
    text, starts = captions[vid]
    i = text.find(quote)
    if i < 0:
        raise SystemExit(f"QUOTE NOT FOUND in {vid}: {quote[:80]!r}")
    sec = [t for off, t in starts if off <= i][-1]
    return sec, f"{sec // 60}:{sec % 60:02d}"


def video_ref(vid, sec):
    return VIDEOS[vid]["title"], f"https://www.youtube.com/watch?v={vid}&t={sec}s"


not_on_sheet, conflicts, problems = [], [], []
for vid, name, raw, conf, tier, verdict, quote in NOT_ON_SHEET:
    sec, ts = locate(vid, quote)
    title, url = video_ref(vid, sec)
    if norm(name) in SHEET_NORM:
        problems.append(f"on sheet already: {name}")
    if len(quote) > 400:
        problems.append(f"long quote ({len(quote)}): {name}")
    not_on_sheet.append({"name": name, "rawCaptionName": raw, "nameConfidence": conf, "videoTitle": title,
                         "videoUrl": url, "timestamp": ts, "tierOrScore": tier, "verdict": verdict, "quote": quote})
for vid, sheet_name, sheet_rank, tier, verdict, quote, *raw in CONFLICTS:
    sec, ts = locate(vid, quote)
    title, url = video_ref(vid, sec)
    if not any(s["name"] == sheet_name and s["rank"] == sheet_rank for s in SHEET):
        problems.append(f"conflict sheet row not found: {sheet_name} [{sheet_rank}]")
    conflicts.append({"name": sheet_name, "rawCaptionName": raw[0] if raw else sheet_name, "sheetRank": sheet_rank,
                      "videoTierOrScore": tier, "videoTitle": title,
                      "videoUrl": url, "timestamp": ts, "verdict": verdict, "quote": quote})

REASON = {
    "y6q1bdrVpsQ": "Sale buyers guide that he titles a SPEEDRUN (50+ IEMs, quick verdicts)",
    "86ycLlC9y8Y": "Sale guide titled SPEEDRUN (quick verdicts)",
    "cejsGrsLBRc": "Black Friday sale guide titled SPEEDRUN (buy/avoid verdicts)",
    "oeNn2Fs5lTk": "Tier-list/speedrun format (titled TIERLIST/SPEEDRUN); mostly line-up building, few verdicts",
    "d_923DbGIu4": "Earliest 'SPEEDRUN' video (Jan 2023 budget picks)",
}
videos = [{"id": v, "title": VIDEOS[v]["title"], "url": f"https://www.youtube.com/watch?v={v}",
           "durationSec": VIDEOS[v]["durationSec"],
           "reason": REASON.get(v, "Title marks it as a speedrun / tier-list / tournament ranking of many IEMs"),
           "notOnSheetCount": sum(1 for e in NOT_ON_SHEET if e[0] == v),
           "conflictCount": sum(1 for e in CONFLICTS if e[0] == v)} for v in PICKED]
out = {
    "source": "Jay Audio (@jayyaudio) YouTube channel; owner of 'Jay's IEM Ranking List' sheet parsed into data/jay_rankings.json",
    "method": "English auto-captions; names resolved against data/raw/jay/phone_book.json and app/public/data/iems.json; quotes verbatim from captions",
    "videos": videos, "notOnSheet": not_on_sheet, "conflicts": conflicts,
}
json.dump(out, open(ROOT / "data/jay_youtube.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
sys.stdout.reconfigure(encoding="utf-8")
print(f"videos {len(videos)}  notOnSheet {len(not_on_sheet)}  conflicts {len(conflicts)}")
for p in problems:
    print("WARN", p)
