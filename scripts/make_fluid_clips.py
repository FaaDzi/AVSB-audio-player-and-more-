"""Cut the colourful fluid bursts for tournament transitions (§64), from Vecteezy's 4k_colorful_fluid_transition(_2).mov.

Each source holds several bursts on black. A burst is the run of frames between black gaps; it is kept only if it
covers the whole screen at some point (checked on a 64x36 copy). Black is keyed to alpha, thin seams are closed so the
screen never shows through while covered, and each clip is encoded as 1280x720 VP9 with alpha.
Prints the table for app/src/game/fireWipe.ts: cover = seconds from the clip's start to its first fully covered frame,
fill = the average colour of that frame (for the backing layer).

Usage: python -I scripts/make_fluid_clips.py tools/ffmpeg/bin <work dir> <clip1.mov> [<clip2.mov> ...]  (clips -> <work dir>/out)
"""
import json, subprocess, sys
import numpy as np
from pathlib import Path

FF = Path(sys.argv[1]); SP = Path(sys.argv[2]); SOURCES = sys.argv[3:]
OUT = SP / "out"
OUT.mkdir(parents=True, exist_ok=True)
FPS = 24
EDGE = 0.03  # coverage that counts as the burst having started or still being there
FULL = 0.995

meta = []
for si, src in enumerate(SOURCES, 1):
    small = SP / f"small{si}.rgb"
    if not small.exists():
        with open(small, "wb") as f:
            subprocess.run([str(FF / "ffmpeg.exe"), "-v", "error", "-i", src, "-vf", "scale=64:36,format=rgb24", "-f", "rawvideo", "-"], stdout=f, check=True)
    a = np.fromfile(small, np.uint8).reshape(-1, 36, 64, 3)
    lit = a.max(axis=3) > 40
    cov = lit.mean(axis=(1, 2))
    # bursts = runs of frames above EDGE
    runs, start = [], None
    for i, c in enumerate(np.append(cov, 0)):
        if c > EDGE and start is None:
            start = i
        elif c <= EDGE and start is not None:
            runs.append((start, i))
            start = None
    for s, e in runs:
        full = np.nonzero(cov[s:e] >= FULL)[0]
        if len(full) == 0:
            print(f"skip {Path(src).name} frames {s}-{e}: max cover {cov[s:e].max():.2f}", flush=True)
            continue
        first = s + int(full[0])
        fill = a[first][lit[first]].mean(axis=0).round().astype(int)
        name = f"fluid-{len(meta) + 1}"
        dst = OUT / f"{name}.webm"
        chain = (f"[0:v]trim=start_frame={s}:end_frame={e},setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,"
                 "colorkey=0x000000:0.04:0.05,format=rgba,split[c][k];"
                 "[k]alphaextract,dilation,dilation,dilation,dilation,erosion,erosion,erosion,erosion[m];"
                 "[c][m]alphamerge,format=yuva420p")
        subprocess.run([str(FF / "ffmpeg.exe"), "-v", "error", "-y", "-i", src, "-an", "-filter_complex", chain,
                        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "36", "-row-mt", "1",
                        "-deadline", "good", "-cpu-used", "2", str(dst)], check=True)
        m = {"src": f"fx/{name}.webm", "cover": round((first - s) / FPS, 2), "duration": round((e - s) / FPS, 2),
             "fill": "rgb({} {} {})".format(*fill), "kb": dst.stat().st_size // 1024}
        meta.append(m)
        print(name, m, flush=True)
(SP / "meta.json").write_text(json.dumps(meta, indent=1))
