"""Make the desktop-quality Opus copies bundled into the Windows Electron app.

- songs/originals/* -> .cache/desktop/songs/<same name>.opus: Opus originals copied untouched,
  anything else encoded to Opus 160 kb/s fullband (20 Hz - 20 kHz)
  + index.json, plus <same name>.jpg cover art at 256 px.
- app/public/tests/abyss/*.flac -> .cache/mobile/tests/abyss/<id>.opus (Opus 192 kb/s).

Opus at 160 kb/s uses fullband stereo encoding (20 Hz - 20 kHz) with transparent audiophile fidelity,
preserving the finest high-frequency and sub-bass nuances of IEM tuning.

Usage: python -I scripts/make_desktop_media.py
"""
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
SONGS = ROOT / "songs" / "originals"
MOBILE_SONGS = ROOT / ".cache" / "mobile" / "songs"
OUT = ROOT / ".cache" / "desktop"
SONGS_OUT = OUT / "songs"
SONG_KBPS = 160
AUDIO = {".flac", ".wav", ".mp3", ".m4a", ".ogg", ".opus", ".aac", ".aiff", ".aif"}

RATES = OUT / "rates.json"
rates: dict[str, int] = json.loads(RATES.read_text(encoding="utf-8")) if RATES.exists() else {}


def to_opus(src: Path, dest: Path, kbps: int) -> Path:
    # an Opus original is copied as is: re-encoding a lossy stream only loses more
    copy = src.suffix.lower() == ".opus"
    key = dest.name
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime and rates.get(key) == (0 if copy else kbps):
        return dest
    tmp = dest.with_suffix(".part.opus")
    codec = ["-c:a", "copy"] if copy else ["-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on", "-application", "audio", "-ar", "48000"]
    subprocess.run([
        str(FFMPEG), "-v", "error", "-y", "-i", str(src),
        "-map", "0:a:0", "-map_metadata", "-1", *codec, str(tmp)
    ], check=True)
    tmp.replace(dest)
    rates[key] = 0 if copy else kbps
    return dest


def cover_of(src: Path, dest: Path) -> Path | None:
    # If mobile cache already has this cover, reuse it directly
    mobile_cover = MOBILE_SONGS / dest.name
    if mobile_cover.exists():
        if not dest.exists() or dest.stat().st_mtime < mobile_cover.stat().st_mtime:
            shutil.copy2(mobile_cover, dest)
        return dest

    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return dest
    r = subprocess.run([
        str(FFMPEG), "-v", "error", "-y", "-i", str(src),
        "-map", "0:v:0", "-frames:v", "1",
        "-vf", "scale=256:256:force_original_aspect_ratio=increase,crop=256:256",
        "-q:v", "4", str(dest)
    ], capture_output=True)
    return dest if r.returncode == 0 and dest.exists() else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    SONGS_OUT.mkdir(parents=True, exist_ok=True)

    song_files = sorted([p for p in SONGS.iterdir() if p.suffix.lower() in AUDIO])
    print(f"Converting {len(song_files)} tracks to Opus {SONG_KBPS} kb/s (Fullband 20Hz-20kHz)...")

    jobs = [(p, SONGS_OUT / (p.stem + ".opus"), SONG_KBPS) for p in song_files]
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, d in enumerate(pool.map(lambda j: to_opus(*j), jobs), 1):
            if i % 25 == 0 or i == len(jobs):
                print(f"  {i}/{len(jobs)} songs encoded", flush=True)
    RATES.write_text(json.dumps(rates, indent=1), encoding="utf-8")

    # Drop orphaned copies
    keep = {d.name for _, d, _ in jobs}
    for d in SONGS_OUT.glob("*.opus"):
        if d.name not in keep:
            d.unlink()

    # Extract or copy covers
    cover_jobs = [(p, SONGS_OUT / (p.stem + ".jpg")) for p in song_files]
    with ThreadPoolExecutor(max_workers=8) as pool:
        covers = {c.stem for c in pool.map(lambda j: cover_of(*j), cover_jobs) if c}
    # and covers of songs that are gone (dist.mjs bundles every file in the folder)
    for c in SONGS_OUT.glob("*.jpg"):
        if c.stem not in covers:
            c.unlink()

    BUILTIN = ROOT / "songs" / "builtin.json"
    builtin_stems = set(json.loads(BUILTIN.read_text(encoding="utf-8"))) if BUILTIN.exists() else set()

    songs_meta = [
        {
            "name": d.name,
            "size": d.stat().st_size,
            **({"builtin": True} if d.stem in builtin_stems else {}),
            **({"cover": d.stem + ".jpg"} if d.stem in covers else {})
        }
        for d in sorted(SONGS_OUT.glob("*.opus"))
    ]
    (SONGS_OUT / "index.json").write_text(json.dumps(songs_meta, ensure_ascii=False), encoding="utf-8")

    total_mb = sum(f.stat().st_size for f in SONGS_OUT.glob("*.opus")) / 1e6
    print(f"Desktop Opus songs complete: {len(songs_meta)} tracks, {total_mb:.1f} MB in {SONGS_OUT}")


if __name__ == "__main__":
    main()

