"""Replace the FLAC rips in songs/originals with YouTube's original Opus stream, untouched.

The FLACs were made by decoding YouTube's Opus to integers: everything the decoder put above
full scale was flattened to exactly 1.0 (hard clipping baked into 149 of 202 files). Fetching
the same stream and remuxing it (yt-dlp -x --audio-format opus on an Opus source copies the
packets, no decode, no re-encode) keeps the overs; the player decodes to float, where they fit.

Per song: URL from the FLAC's `purl` tag -> download -> check the duration matches -> copy the
FLAC's tags and cover art -> write <same name>.opus -> delete the FLAC. A song whose download or
check fails keeps its FLAC. Resumable: songs already converted are skipped.

Usage: python -I scripts/rerip_songs.py [--workers 4] [--only 034,098]
"""
import argparse
import base64
import json
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from mutagen.flac import FLAC
from mutagen.oggopus import OggOpus

ROOT = Path(__file__).resolve().parent.parent
SONGS = ROOT / "songs" / "originals"
FFPROBE = ROOT / "tools" / "ffmpeg" / "bin" / "ffprobe.exe"
FFMPEG_DIR = ROOT / "tools" / "ffmpeg" / "bin"
LOG = ROOT / "songs" / "rerip_log.json"


def duration(p: Path) -> float:
    out = subprocess.run([str(FFPROBE), "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(p)],
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    return float(out.strip() or 0)


def codec(p: Path) -> str:
    return subprocess.run([str(FFPROBE), "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
                           "-of", "default=nw=1:nk=1", str(p)], capture_output=True, text=True).stdout.strip()


def rerip(flac_path: Path) -> dict:
    stem = flac_path.stem
    res = {"file": flac_path.name}
    try:
        old = FLAC(flac_path)
        url = (old.get("purl") or [""])[0]
        if not url:
            return {**res, "status": "skipped", "why": "no purl tag"}
        res["url"] = url
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run(
                ["yt-dlp", "--ignore-config", "--no-playlist", "--js-runtimes", "node", "--ffmpeg-location", str(FFMPEG_DIR),
                 "--retries", "10", "-f", "bestaudio[acodec=opus]", "-x", "--audio-format", "opus",
                 "-P", tmp, "-o", "a.%(ext)s", url],
                capture_output=True, text=True, encoding="utf-8", errors="replace")
            got = next(Path(tmp).glob("a.opus"), None)
            if r.returncode != 0 or not got:
                return {**res, "status": "failed", "why": (r.stderr.strip().splitlines() or ["?"])[-1][:200]}
            if codec(got) != "opus":
                return {**res, "status": "failed", "why": f"not opus: {codec(got)}"}
            d_old, d_new = duration(flac_path), duration(got)
            res.update(old_s=round(d_old, 2), new_s=round(d_new, 2))
            if abs(d_old - d_new) > 1.5:
                return {**res, "status": "failed", "why": "duration mismatch"}
            new = OggOpus(got)
            new.delete()
            for k, v in old.tags.items():
                new[k] = v
            if old.pictures:
                new["metadata_block_picture"] = [base64.b64encode(p.write()).decode("ascii") for p in old.pictures]
            new.save()
            if old.pictures and not OggOpus(got).get("metadata_block_picture"):
                return {**res, "status": "failed", "why": "cover art not written"}
            dest = SONGS / f"{stem}.opus"
            shutil.move(str(got), dest)
        flac_path.unlink()
        return {**res, "status": "ok", "kbps": round(dest.stat().st_size * 8 / 1000 / max(d_new, 1))}
    except Exception as e:  # keep the FLAC on any error
        return {**res, "status": "failed", "why": str(e)[:200]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--only", default="", help="comma-separated track numbers")
    a = ap.parse_args()
    files = sorted(SONGS.glob("*.flac"))
    if a.only:
        want = {str(int(n)) for n in a.only.split(",")}
        files = [f for f in files if str(int(f.name.split(" ")[0])) in want]
    log = json.loads(LOG.read_text(encoding="utf-8")) if LOG.exists() else {}
    with ThreadPoolExecutor(a.workers) as pool:
        for i, r in enumerate(pool.map(rerip, files), 1):
            log[r["file"]] = r
            print(f"[{i}/{len(files)}] {r['status']:7} {r['file']}" + (f"  ({r.get('why')})" if r["status"] != "ok" else ""), flush=True)
            LOG.write_text(json.dumps(log, indent=1, ensure_ascii=False), encoding="utf-8")
    bad = [r for r in log.values() if r["status"] != "ok"]
    print(f"done: {sum(r['status'] == 'ok' for r in log.values())} ok, {len(bad)} not converted (FLAC kept)")


if __name__ == "__main__":
    main()
