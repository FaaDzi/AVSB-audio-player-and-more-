"""Download YouTube auto-captions for the picked reviewer videos, slowly and politely.

At most --max videos per run (default 5), one at a time, with a long pause between
videos. Stops at the first HTTP 429 (rate limit) and leaves the rest for a later run.
Already-downloaded captions are skipped, so just re-run it later to continue.

Usage: python -I scripts/reviewers/fetch_captions_slow.py [--max 5] [--pause 90]
       [--log FILE] [--task-name NAME]   (scheduled use: append to a log, and delete the
                                          Windows scheduled task NAME once nothing is left)
"""
import argparse
import datetime
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
YTDLP = ROOT / ".venv" / "Scripts" / "yt-dlp.exe"
REVIEWERS = ["gizaudio", "super-review", "hawaii-bad-boy"]


def pending():
    for slug in REVIEWERS:
        d = ROOT / "data" / "raw" / "reviewers" / slug
        picked = d / "picked.txt"
        if not picked.exists():
            continue
        for line in picked.read_text(encoding="utf-8").split():
            vid = line.strip()[:11]
            if len(vid) == 11 and not list((d / "subs").glob(f"{vid}*.vtt")):
                yield slug, vid, d


LOG = None
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # no console flash when run by Task Scheduler


def say(msg):
    line = f"{datetime.datetime.now():%Y-%m-%d %H:%M} {msg}"
    if LOG:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    else:
        print(line, flush=True)


def remove_task(name):
    r = subprocess.run(["schtasks", "/Delete", "/TN", name, "/F"], capture_output=True, text=True, creationflags=NO_WINDOW)
    say(f"all captions downloaded; removed scheduled task '{name}'" if r.returncode == 0
        else f"all captions downloaded; could not remove task '{name}': {r.stderr.strip()}")


def main():
    global LOG
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=5)
    ap.add_argument("--pause", type=int, default=90, help="seconds between videos")
    ap.add_argument("--log", help="append progress to this file instead of printing")
    ap.add_argument("--task-name", help="Windows scheduled task to delete once everything is downloaded")
    args = ap.parse_args()
    LOG = args.log

    todo = list(pending())
    if not todo:
        if args.task_name:
            remove_task(args.task_name)
        else:
            say("nothing left to download")
        return
    say(f"{len(todo)} videos still need captions; fetching up to {args.max}")
    for n, (slug, vid, d) in enumerate(todo[: args.max]):
        if n:
            time.sleep(args.pause)
        (d / "subs").mkdir(exist_ok=True)
        r = subprocess.run(
            [str(YTDLP), "--no-cache-dir", "--skip-download", "--write-auto-subs", "--sub-langs", "en",
             "--sub-format", "vtt", "--sleep-requests", "3", "-o", str(d / "subs" / "%(id)s.%(ext)s"),
             f"https://www.youtube.com/watch?v={vid}"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW,
        )
        out = r.stdout + r.stderr
        if "429" in out:
            say(f"{slug}/{vid}: rate-limited (429). Stopping; next run will try again.")
            return
        ok = bool(list((d / "subs").glob(f"{vid}*.vtt")))
        say(f"{slug}/{vid}: {'ok' if ok else 'no captions: ' + (out.strip().splitlines() or ['?'])[-1][:120]}")
    left = len(list(pending()))
    say(f"done for this run; {left} left")
    if not left and args.task_name:
        remove_task(args.task_name)


if __name__ == "__main__":
    main()
