"""Convert YouTube auto-caption VTT files into de-duplicated timestamped text.

Usage: .venv/Scripts/python -I scripts/vtt_to_text.py <dir with *.vtt>
Writes <id>.txt next to each <id>.en.vtt, one line per caption line: "[m:ss] text".
"""
import html
import re
import sys
from pathlib import Path

TS = re.compile(r"^(\d+):(\d\d):(\d\d)\.\d+ --> ")
TAG = re.compile(r"<[^>]+>")


def fmt(sec):
    m, s = divmod(int(sec), 60)
    return f"{m}:{s:02d}"


def convert(path):
    out, recent, start = [], [], 0
    for raw in path.read_text(encoding="utf-8").splitlines():
        m = TS.match(raw)
        if m:
            h, mi, s = map(int, m.groups())
            start = h * 3600 + mi * 60 + s
            continue
        if not raw.strip() or raw.startswith(("WEBVTT", "Kind:", "Language:")) or "-->" in raw:
            continue
        line = " ".join(html.unescape(TAG.sub("", raw)).split())
        if not line or line in recent:
            continue
        recent = (recent + [line])[-3:]
        out.append(f"[{fmt(start)}] {line}")
    return out


for vtt in sorted(Path(sys.argv[1]).glob("*.vtt")):
    vid = vtt.name.split(".")[0]
    lines = convert(vtt)
    (vtt.parent / f"{vid}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(vid, len(lines))
