"""DankPods' opinions (data/dankpods.json: researched from the auto-captions of his own videos, with
the video and timestamp of each) as reviewer comments in reviews.json.

Entries whose product is named in the video (not inferred) and is in the catalog go in, each linked
to its video at the moment he says it. Where the captions were too garbled to quote (quoteVerified
false) the line is a paraphrase and is marked "summarised". `catalogName` is
the exact catalog row the entry was checked against; merges in aliases.json carry it to the kept model.

Usage: python -I scripts/dankpods_reviews.py
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jaytiss_reviews import DATA, put_comments  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "dankpods.json"
REVIEWER = "DankPods"
LEANING = {"loves": "Loves it", "likes": "Likes it", "mixed": "Mixed", "dislikes": "Not a fan"}


def at(url: str, ts: str | None) -> str:
    """The video at the moment he says it (YouTube's &t=…s)."""
    if not ts:
        return url
    parts = [int(p) for p in ts.split(":")]
    secs = sum(p * 60 ** i for i, p in enumerate(reversed(parts)))
    return f"{url}{'&' if '?' in url else '?'}t={secs}s"


def dankpods_comments(iems: list[dict], hps: list[dict], merge: dict[str, str]) -> tuple[dict, list[str]]:
    if not SOURCE.exists():
        return {}, []
    entries = json.loads(SOURCE.read_text(encoding="utf-8"))["entries"]
    by_name = {"iem": {i["name"]: i["id"] for i in iems}, "headphone": {i["name"]: i["id"] for i in hps}}
    by_name["tws"] = by_name["iem"]
    comments, skipped = defaultdict(list), []
    for e in entries:
        if not e.get("catalogName") or re.search(r"\binferr?", e.get("source", ""), re.I):
            skipped.append(e["product"])
            continue
        iid = by_name[e["kind"]].get(e["catalogName"])
        if not iid:
            skipped.append(e["product"])
            continue
        iid = merge.get(iid, iid)
        comments[iid].append({
            "reviewer": REVIEWER,
            "sourceType": "youtube",
            # a paraphrase (the captions were garbled there) says so; the link goes to the moment either way
            "grade": " · ".join(x for x in (LEANING.get(e["leaning"]), None if e.get("quoteVerified") else "summarised") if x),
            "verdict": None,
            "quote": e["verdict"],
            "url": at(e["url"], e.get("timestamp")),
            "timestamp": e.get("timestamp"),
        })
    return comments, skipped


def main():
    iems = json.loads((DATA / "iems.json").read_text(encoding="utf-8"))["iems"]
    hps = json.loads((DATA / "headphones.json").read_text(encoding="utf-8"))["iems"]
    merge = json.loads((DATA / "aliases.json").read_text(encoding="utf-8"))["merge"]
    comments, skipped = dankpods_comments(iems, hps, merge)
    put_comments(REVIEWER, comments)
    print(f"{sum(len(v) for v in comments.values())} on {len(comments)} models; {len(skipped)} left out: {', '.join(skipped)}")


if __name__ == "__main__":
    main()
