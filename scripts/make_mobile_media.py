"""Make the phone-sized copies the Android app bundles.

- songs/originals/*  -> .cache/mobile/songs/<same name>.opus   (Opus originals copied as is, others Opus 128 kb/s) + index.json,
  plus <same name>.jpg, the embedded cover at 256 px (the Opus copies carry no tags)
- app/public/tests/abyss/*.flac -> .cache/mobile/tests/abyss/<id>.opus (Opus 192 kb/s),
  plus index.json pointing at the .opus files; the videos are bundled as they are.

Opus at these rates is transparent for nearly all listeners, and keeps the full 20 kHz band,
so the IEM filters' tonal differences come through intact. Songs are 128 kb/s (close to the ~130-160 kb/s YouTube streams them at) to keep the APK
near 900 MB; ear training stays at 192 kb/s since its soundstage/imaging tests lean on the
stereo image, the first thing lower Opus rates soften. Same file stems, so the song list's
pins still match. Resumable: files already converted at the same rate (and newer than their
source) are skipped; changing a rate re-encodes.

Usage: python -I scripts/make_mobile_media.py
"""
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
SONGS = ROOT / "songs" / "originals"
TESTS = ROOT / "app" / "public" / "tests" / "abyss"
OUT = ROOT / ".cache" / "mobile"
SONG_KBPS = 128
TEST_KBPS = 192
SKIPPED_TESTS = {"intro", "ending"}  # the video's intro/outro music: the app doesn't offer them (TestView.tsx)
AUDIO = {".flac", ".wav", ".mp3", ".m4a", ".ogg", ".opus", ".aac", ".aiff", ".aif"}


RATES = OUT / "rates.json"  # bitrate each copy was made at, so a rate change re-encodes
rates: dict[str, int] = json.loads(RATES.read_text(encoding="utf-8")) if RATES.exists() else {}


def to_opus(src: Path, dest: Path, kbps: int) -> Path:
    # an Opus original (YouTube's own stream, ~130 kb/s) is copied as is: re-encoding it would
    # only add a second generation of loss for a couple of percent less size
    copy = src.suffix.lower() == ".opus"
    key = dest.relative_to(OUT).as_posix()
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime and rates.get(key) == (0 if copy else kbps):
        return dest
    tmp = dest.with_suffix(".part.opus")
    codec = ["-c:a", "copy"] if copy else ["-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on", "-application", "audio", "-ar", "48000"]
    subprocess.run([str(FFMPEG), "-v", "error", "-y", "-i", str(src), "-map", "0:a:0", "-map_metadata", "-1",
                    *codec, str(tmp)], check=True)
    tmp.replace(dest)
    rates[key] = 0 if copy else kbps
    return dest


def cover_of(src: Path, dest: Path) -> Path | None:
    """The song's embedded cover as a 256 px JPEG, or None if it has none."""
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return dest
    r = subprocess.run([str(FFMPEG), "-v", "error", "-y", "-i", str(src), "-map", "0:v:0", "-frames:v", "1",
                        "-vf", "scale=256:256:force_original_aspect_ratio=increase,crop=256:256", "-q:v", "4", str(dest)],
                       capture_output=True)
    return dest if r.returncode == 0 and dest.exists() else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    songs_out = OUT / "songs"
    tests_out = OUT / "tests" / "abyss"
    songs_out.mkdir(parents=True, exist_ok=True)
    tests_out.mkdir(parents=True, exist_ok=True)

    jobs = [(p, songs_out / (p.stem + ".opus"), SONG_KBPS) for p in sorted(SONGS.iterdir()) if p.suffix.lower() in AUDIO]
    jobs += [(p, tests_out / (p.stem + ".opus"), TEST_KBPS) for p in sorted(TESTS.glob("*.flac")) if p.stem not in SKIPPED_TESTS]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for i, d in enumerate(pool.map(lambda j: to_opus(*j), jobs), 1):
            if i % 20 == 0 or i == len(jobs):
                print(f"{i}/{len(jobs)} converted", flush=True)
    RATES.write_text(json.dumps(rates, indent=1), encoding="utf-8")

    # drop copies whose source is gone (renamed or deleted songs)
    keep = {d.name for _, d, _ in jobs}
    for d in list(songs_out.glob("*.opus")) + list(tests_out.glob("*.opus")):
        if d.name not in keep:
            d.unlink()

    song_src = [(p, songs_out / (p.stem + ".jpg")) for p, _, k in jobs if k == SONG_KBPS]
    with ThreadPoolExecutor(max_workers=6) as pool:
        covers = {c.stem for c in pool.map(lambda j: cover_of(*j), song_src) if c}
    for c in songs_out.glob("*.jpg"):
        if c.stem not in covers:
            c.unlink()
    BUILTIN = ROOT / "songs" / "builtin.json"
    builtin_stems = set(json.loads(BUILTIN.read_text(encoding="utf-8"))) if BUILTIN.exists() else set()

    songs = [{
        "name": d.name,
        "size": d.stat().st_size,
        **({"builtin": True} if d.stem in builtin_stems else {}),
        **({"cover": d.stem + ".jpg"} if d.stem in covers else {})
    } for d in sorted(songs_out.glob("*.opus"))]
    (songs_out / "index.json").write_text(json.dumps(songs, ensure_ascii=False), encoding="utf-8")
    index = json.loads((TESTS / "index.json").read_text(encoding="utf-8"))
    index["tracks"] = [t for t in index["tracks"] if t["id"] not in SKIPPED_TESTS]
    for t in index["tracks"]:
        t["file"] = t["file"].rsplit(".", 1)[0] + ".opus"
    (tests_out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    mb = lambda files: sum(f.stat().st_size for f in files) / 1e6  # noqa: E731
    src_mb = mb(p for p, _, k in jobs if k == SONG_KBPS)
    print(f"songs: {len(songs)} files, {src_mb:.0f} MB -> {mb(songs_out.glob('*.opus')):.0f} MB")
    print(f"ear training: {mb(TESTS.glob('*.flac')):.0f} MB -> {mb(tests_out.glob('*.opus')):.0f} MB")


if __name__ == "__main__":
    main()
