"""Build app/public/data/reviews.json from Jay's parsed ranking sheet.

Each Jay entry is linked to a measured IEM only on a strict normalised-name match
(no fuzzy guessing). His grades and notes are kept verbatim; keywords come from
phrases that literally appear in the notes, each with its sentence as evidence.
Entries that can't be linked are listed in data/jay_unmatched.txt.

Usage: python -I scripts/build_reviews.py
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
from jay_keywords import extract
from dankpods_reviews import dankpods_comments
from jaytiss_reviews import jaytiss_comments
from kitab_reviews import kitab_comments, write_eartips
from requiem_reviews import requiem_comments
from names import base, jay_keys, key

ROOT = Path(__file__).resolve().parent.parent
JAY = ROOT / "data" / "jay_rankings.json"
CATALOG = ROOT / "app" / "public" / "data" / "iems.json"
HEADPHONES = ROOT / "app" / "public" / "data" / "headphones.json"
OUT = ROOT / "app" / "public" / "data" / "reviews.json"
UNMATCHED = ROOT / "data" / "jay_unmatched.txt"
# Hand-checked links for names that differ beyond normalisation: Jay name -> catalog name.
ALIASES_FILE = ROOT / "data" / "jay_aliases.json"


YOUTUBE = ROOT / "data" / "jay_youtube.json"
REVIEWERS = ROOT / "data" / "reviewers"


def norm_text(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def main():
    jay = json.loads(JAY.read_text(encoding="utf-8"))
    iems = json.loads(CATALOG.read_text(encoding="utf-8"))["iems"]
    headphones = json.loads(HEADPHONES.read_text(encoding="utf-8"))["iems"] if HEADPHONES.exists() else []
    all_gear = iems + headphones
    aliases = json.loads(ALIASES_FILE.read_text(encoding="utf-8")) if ALIASES_FILE.exists() else {}

    by_key = {key(i["name"]): i["id"] for i in all_gear}
    by_name = {i["name"]: i["id"] for i in all_gear}
    by_base = defaultdict(set)
    for i in all_gear:
        by_base[key(base(i["name"]))].add(i["id"])

    def link(name: str):
        if name in aliases:  # target may be spelled differently once a higher-priority source wins
            return by_name.get(aliases[name]) or by_key.get(key(aliases[name]))
        for k in jay_keys(name):
            if k in by_key:
                return by_key[k]
            if len(by_base.get(k, ())) == 1:
                return next(iter(by_base[k]))
        return None

    reviews, unmatched = defaultdict(list), []
    for row in jay:
        iem_id = link(row["name"])
        if not iem_id:
            unmatched.append(row["name"])
            continue
        reviews[iem_id].append({
            "jay": {k: row[k] for k in ("name", "rank", "score", "tuning", "tech", "value", "valueStars",
                                         "flags", "volume", "tier", "priceUsd", "discontinued", "notes")},
            "pink": row.get("pink", False),
            "link": row.get("link"),
            "keywords": extract(row["notes"]),
        })

    videos, video_skipped = defaultdict(list), 0
    if YOUTUBE.exists():
        yt = json.loads(YOUTUBE.read_text(encoding="utf-8"))
        captions = " ".join(norm_text(p.read_text(encoding="utf-8", errors="replace"))
                            for p in (ROOT / "data" / "raw" / "jay" / "youtube").rglob("*.txt"))
        for kind in ("notOnSheet", "conflicts"):
            for e in yt.get(kind, []):
                iem_id = link(e["name"])
                if not iem_id or e.get("nameConfidence") == "low":
                    video_skipped += 1
                    continue
                videos[iem_id].append({
                    "kind": kind,
                    "videoTitle": e["videoTitle"],
                    "videoUrl": e["videoUrl"],
                    "timestamp": e["timestamp"],
                    "tierOrScore": e.get("tierOrScore"),
                    "verdict": e["verdict"],
                    "quote": e["quote"],
                    "quoteVerified": norm_text(e["quote"]) in captions,
                })

    # Other reviewers (data/reviewers/*.json): one comment per verified quote on a confidently named IEM.
    comments, comment_stats = defaultdict(list), {}
    for f in sorted(REVIEWERS.glob("*.json")):
        src = json.loads(f.read_text(encoding="utf-8"))
        used = 0
        for e in src.get("entries", []):
            iem_id = link(e["name"])
            if not iem_id or e.get("nameConfidence") == "low" or not e.get("quoteVerified") or not e.get("quote"):
                continue
            comments[iem_id].append({
                "reviewer": src["reviewer"],
                "sourceType": src.get("sourceType"),
                "grade": e.get("grade"),
                "verdict": e.get("verdict"),
                "quote": e["quote"],
                "url": e.get("url") or src.get("sourceUrl"),
                "timestamp": e.get("timestamp"),
            })
            used += 1
        comment_stats[src["reviewer"]] = used

    # Fernanda Gunsan's Kitab Audio (IEMs, TWS and headphones), translated from Indonesian
    headphones = json.loads(HEADPHONES.read_text(encoding="utf-8"))["iems"] if HEADPHONES.exists() else []
    kitab, kitab_unmatched = kitab_comments(iems, headphones)
    for target, cms in kitab.items():
        comments[target].extend(cms)
    comment_stats["Fernanda Gunsan"] = sum(len(v) for v in kitab.values())
    # Jaytiss's ranking sheet (data/jaytiss.json, scripts/jaytiss_reviews.py)
    merge = json.loads((ROOT / "app" / "public" / "data" / "aliases.json").read_text(encoding="utf-8"))["merge"]
    jaytiss, _ = jaytiss_comments(iems, headphones, merge)
    for target, cms in jaytiss.items():
        comments[target].extend(cms)
    comment_stats["Jaytiss"] = sum(len(v) for v in jaytiss.values())
    # RequIEM's ranking (data/requiem.json, scripts/requiem_reviews.py)
    requiem, _ = requiem_comments(iems, headphones, merge)
    for target, cms in requiem.items():
        comments[target].extend(cms)
    comment_stats["RequIEM"] = sum(len(v) for v in requiem.values())
    # DankPods (data/dankpods.json, scripts/dankpods_reviews.py)
    dankpods, _ = dankpods_comments(iems, headphones, merge)
    for target, cms in dankpods.items():
        comments[target].extend(cms)
    comment_stats["DankPods"] = sum(len(v) for v in dankpods.values())
    print(f"eartips guide: {write_eartips()} tips -> eartips.json")
    if kitab or kitab_unmatched:
        print(f"Fernanda Gunsan: {comment_stats['Fernanda Gunsan']} linked, {len(kitab_unmatched)} unmatched -> kitab_unmatched.txt")

    OUT.write_text(json.dumps({
        "source": "Jay Audio (@jayyaudio) IEM Ranking List (Google Sheet export), parsed by scripts/parse_jay.py",
        "videoSource": "Jay Audio SPEEDRUN videos, auto-captions (data/jay_youtube.json)",
        "reviews": reviews,
        "videos": videos,
        "comments": comments,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if comment_stats:
        print("other reviewers:", ", ".join(f"{k} {v}" for k, v in comment_stats.items()),
              f"-> comments on {len(comments)} IEMs")
    UNMATCHED.write_text("\n".join(sorted(set(unmatched))) + "\n", encoding="utf-8")
    print(f"linked {sum(len(v) for v in reviews.values())} entries to {len(reviews)} IEMs; "
          f"{len(unmatched)} unmatched -> {UNMATCHED.name}")
    print(f"video verdicts: {sum(len(v) for v in videos.values())} linked to {len(videos)} IEMs, "
          f"{video_skipped} skipped (unlinked or low-confidence name)")


if __name__ == "__main__":
    main()
