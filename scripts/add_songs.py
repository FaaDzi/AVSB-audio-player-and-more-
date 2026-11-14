"""Add new songs to songs/originals from YouTube, the same way rerip_songs.py fetched the rest:
the original Opus stream remuxed (no decode, no re-encode), tagged, with the video thumbnail as
cover art.

  1. --pick      search YouTube for each song in the list and choose an upload: an auto-generated
                 "- Topic" upload (the label's album audio) when one matches, else an official
                 channel; writes the choice back into the list as 'url' (+ 'channel', 'yt_title')
                 for checking by eye. Songs that already have a 'url' are left alone.
  2. --download  fetch each chosen upload to "<NNN> - <Artist> - <Title>.opus", numbering on from
                 the highest track number in songs/originals, and add its data/song_metadata.json entry.

Usage: python -I scripts/add_songs.py data/new_songs_2026-10.json --pick | --download [--workers 4]
"""
import argparse
import base64
import json
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from mutagen.flac import Picture
from mutagen.oggopus import OggOpus

ROOT = Path(__file__).resolve().parent.parent
SONGS = ROOT / "songs" / "originals"
META = ROOT / "data" / "song_metadata.json"
FFPROBE = ROOT / "tools" / "ffmpeg" / "bin" / "ffprobe.exe"
FFMPEG_DIR = ROOT / "tools" / "ffmpeg" / "bin"
YTDLP = ["yt-dlp", "--ignore-config", "--no-playlist", "--js-runtimes", "node", "--ffmpeg-location", str(FFMPEG_DIR), "--retries", "10"]

key = lambda s: re.sub(r"[^\w]", "", s.lower())


def search(query: str, n: int = 8) -> list[dict]:
    r = subprocess.run([*YTDLP, "--flat-playlist", "-J", f"ytsearch{n}:{query}"], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        return []
    return [e for e in json.loads(r.stdout).get("entries", []) if e]


def score(song: dict, e: dict) -> float:
    """Higher is better: a matching Topic upload, then official-looking channels; covers, remixes,
    nightcore, sped-up, extended and lyric re-uploads lose."""
    title, chan = e.get("title") or "", e.get("channel") or e.get("uploader") or ""
    t, c = title.lower(), chan.lower()
    words = [w for w in re.findall(r"\w+", song["title"].split("(")[0].lower()) if len(w) > 1]
    hit = sum(w in t for w in words) / max(1, len(words))
    s = hit * 4
    if c.endswith(" - topic"):
        s += 3
    elif any(x in c for x in ("vevo", "official", "records", "music")) or key(song["artist"].split(" ")[0]) in key(chan):
        s += 1.5
    bad = ("cover", "nightcore", "sped up", "slowed", "8d", "1 hour", "loop", "reaction", "karaoke", "instrumental", "ai ")
    if "remix" not in song["title"].lower():
        bad += ("remix",)
    s -= 3 * sum(b in t for b in bad)
    d = e.get("duration") or 0
    if d and (d < 60 or d > 900):
        s -= 3
    return s


def pick(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    for song in data["songs"]:
        if song.get("url"):
            continue
        cands = search(song["query"])
        if not cands:
            print(f"NO RESULTS  {song['artist']} - {song['title']}")
            continue
        best = max(cands, key=lambda e: score(song, e))
        song.update(url=f"https://www.youtube.com/watch?v={best['id']}", channel=best.get("channel") or best.get("uploader"),
                    yt_title=best.get("title"), yt_duration=best.get("duration"))
        print(f"{score(song, best):5.1f}  {song['artist']} - {song['title']}\n       -> [{song['channel']}] {song['yt_title']} ({song['yt_duration']} s)", flush=True)
        path.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


def probe(p: Path, entries: str) -> str:
    return subprocess.run([str(FFPROBE), "-v", "error", "-select_streams", "a:0", "-show_entries", entries, "-of", "default=nw=1:nk=1", str(p)],
                          capture_output=True, text=True).stdout.strip()


def safe(s: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', "", s).strip()


def fetch(job: tuple[int, dict]) -> dict:
    num, song = job
    name = f"{num:03d} - {safe(song['artist'])} - {safe(song['title'])}.opus"
    res = {"file": name, "url": song["url"]}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run([*YTDLP, "-f", "bestaudio[acodec=opus]", "-x", "--audio-format", "opus", "--write-thumbnail",
                                "--convert-thumbnails", "jpg", "-P", tmp, "-o", "a.%(ext)s", song["url"]],
                               capture_output=True, text=True, encoding="utf-8", errors="replace")
            got = Path(tmp) / "a.opus"
            if r.returncode != 0 or not got.exists():
                return {**res, "status": "failed", "why": (r.stderr.strip().splitlines() or ["?"])[-1][:200]}
            if probe(got, "stream=codec_name") != "opus":
                return {**res, "status": "failed", "why": "not opus"}
            tags = OggOpus(got)
            tags.delete()
            tags.update({"artist": song["artist"], "title": song["title"], "album": song.get("album", ""),
                         "date": str(song.get("year") or ""), "purl": song["url"]})
            thumb = Path(tmp) / "a.jpg"
            if thumb.exists():
                pic = Picture()
                pic.type, pic.mime, pic.data = 3, "image/jpeg", thumb.read_bytes()
                tags["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]
            tags.save()
            secs = float(probe(got, "format=duration") or probe(got, "stream=duration") or 0)
            dest = SONGS / name
            shutil.move(str(got), dest)
        return {**res, "status": "ok", "num": num, "channels": int(probe(dest, "stream=channels") or 0),
                "kbps": round(dest.stat().st_size * 8 / 1000 / max(secs, 1)), "s": round(secs)}
    except Exception as e:
        return {**res, "status": "failed", "why": str(e)[:200]}


def download(path: Path, workers: int):
    data = json.loads(path.read_text(encoding="utf-8"))
    have = {key(f.stem.split(" - ", 2)[-1]) for f in SONGS.glob("*.opus")}
    top = max(int(f.name.split(" ")[0]) for f in SONGS.glob("*.opus"))
    jobs = []
    for song in data["songs"]:
        if not song.get("url") or key(safe(song["title"])) in have:
            continue
        top += 1
        jobs.append((top, song))
    meta = json.loads(META.read_text(encoding="utf-8"))
    with ThreadPoolExecutor(workers) as pool:
        for i, r in enumerate(pool.map(fetch, jobs), 1):
            extra = f"  {r.get('kbps')} kb/s, {r.get('channels')} ch, {r.get('s')} s" if r["status"] == "ok" else f"  ({r.get('why')})"
            print(f"[{i}/{len(jobs)}] {r['status']:6} {r['file']}{extra}", flush=True)
            if r["status"] == "ok":
                song = dict(jobs[i - 1][1])
                meta[f"{r['num']:03d}"] = {k: song[k] for k in ("artist", "title", "album", "year", "genre", "from") if k in song}
                # the file has CRLF line endings
                META.write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\r\n")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("list")
    ap.add_argument("--pick", action="store_true")
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    if a.pick:
        pick(Path(a.list))
    if a.download:
        download(Path(a.list), a.workers)


if __name__ == "__main__":
    main()
