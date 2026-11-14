"""Cut the Abyss headphone-test WAV into per-chapter 48 kHz / 16-bit FLAC files + index.json.

Chapter positions in the WAV come from scripts/align_abyss.py (plus sub-alignment of the
imaging and dynamic-range sections, which differ in length from the video).

Usage: python -I scripts/cut_abyss.py "<path to Abyss Headphone Test Lossless.wav>"
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
OUT = ROOT / "app" / "public" / "tests" / "abyss"

SEGMENTS = [  # id, title, wav start, wav end, music credit, video timestamp
    ("intro", "Intro", 0.0, 38.7, "ES Our Last Stand - FormantX", "0:00"),
    ("soundstage-1", "Soundstage Test 1", 38.7, 150.7, "ES All Will Pass - Alfie Jay Winters", "0:24"),
    ("soundstage-2", "Soundstage Test 2", 150.7, 208.7, "ES Future Explorations - John Barzetti", "2:16"),
    ("bass-soundstage", "Bass Soundstage", 208.7, 288.7, "ES Snack Bar - Jobii", "3:14"),
    ("imaging", "Imaging Test (Directional Accuracy)", 288.7, 873.2, "", "4:34"),
    ("vocal-1", "Vocal Test 1", 873.2, 963.2, "ES For The Brownest Eyes In Town - Arch Tremors", "10:42"),
    ("vocal-2", "Vocal Test 2", 963.2, 1106.2, "ES I Am Better Off [Jazz version] - Wildson", "12:12"),
    ("vocal-3", "Vocal Test 3", 1106.2, 1246.2, "ES There's a New Day - Staffan Carlen", "14:35"),
    ("electronic", "Genre: Mixed Electronic", 1246.2, 1345.2, "ES Snowprints - Valante", "16:55"),
    ("rap", "Genre: Rap", 1345.2, 1426.2, "ES For The Record - Dylan Sitts Remix", "18:34"),
    ("orchestral", "Genre: Orchestral", 1426.2, 1564.2, "ES This Creed - Johannes Barnlof", "19:55"),
    ("dynamic-range-explained", "Dynamic Range Test (explanation)", 1564.2, 1627.6, "", "22:13"),
    ("dynamic-range", "Dynamic Range Test", 1627.6, 1682.6, "", "23:22"),
    ("ending", "Ending", 1682.6, 1728.0, "ES Zion - Edgar Hopp", "24:17"),
]


def main(src):
    OUT.mkdir(parents=True, exist_ok=True)
    items = []
    for sid, title, a, b, music, yt in SEGMENTS:
        dest = OUT / f"{sid}.flac"
        subprocess.run([str(FFMPEG), "-v", "error", "-y", "-ss", str(a), "-to", str(b), "-i", src,
                        # 16-bit with triangular dither: CD quality, ~1/3 smaller than 24-bit, no audible loss
                        "-af", "aresample=48000:resampler=soxr:precision=28:osf=s16:dither_method=triangular", "-sample_fmt", "s16",
                        "-c:a", "flac", "-compression_level", "8", str(dest)], check=True)
        items.append({"id": sid, "title": title, "file": f"tests/abyss/{sid}.flac",
                      "duration": round(b - a, 1), "music": music, "youtube": yt})
        print(f"{sid:26} {b - a:6.1f}s {dest.stat().st_size / 1e6:6.1f} MB", flush=True)
    (OUT / "index.json").write_text(json.dumps({
        "name": "Abyss: The Ultimate Headphones Test",
        "video": "https://www.youtube.com/watch?v=tezCWPLwu3Q",
        "tracks": items,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{sum(p.stat().st_size for p in OUT.glob('*.flac')) / 1e6:.0f} MB total")


if __name__ == "__main__":
    main(sys.argv[1])
