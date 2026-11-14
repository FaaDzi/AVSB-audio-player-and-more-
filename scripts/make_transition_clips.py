"""Cut, key (black -> alpha), recolour and encode the bracket transition clips (§35).

Source: fluid_liquid_transition_pack.mov (1920x1080, 30 fps, transitions on black). Fire stays yellow (IEMs),
the red laser turns cyan (TWS), the blue liquid turns orange (headphones). Thin black seams inside the shapes
are closed in the alpha so the screen never shows through while covered. Prints each clip's cover estimate;
the exact cover times in app/src/game/fireWipe.ts are the first frame with no see-through pixels.

Usage: python -I scripts/make_transition_clips.py tools/ffmpeg/bin <pack.mov> <work dir>  (clips -> <work dir>/out)
"""
import json, subprocess, sys
import numpy as np
from pathlib import Path
FF = Path(sys.argv[1]); SRC = sys.argv[2]; SP = Path(sys.argv[3]); OUT = SP / "out"
OUT.mkdir(parents=True, exist_ok=True)
if not (SP / "small.rgb").exists():  # 64x36 copy of every frame, to find each piece and when it covers
    with open(SP / "small.rgb", "wb") as f:
        subprocess.run([str(FF / "ffmpeg.exe"), "-v", "error", "-i", SRC, "-vf", "scale=64:36,format=rgb24", "-f", "rawvideo", "-"], stdout=f, check=True)
a = np.fromfile(SP / "small.rgb", np.uint8).reshape(-1, 36, 64, 3)
cov = (a.max(axis=3) > 40).mean(axis=(1, 2))
FPS = 30
# name, segment frames, mode (inout = covers then clears; pingpong = covers, then the same frames reversed), hue shift
# red laser -> TWS cyan, blue water -> headphone orange (channel swaps keep white cores white and stay bright)
CYAN = "colorchannelmixer=rr=0.15:rg=0.85:gg=0.25:gr=0.9:bb=0.2:br=1"
ORANGE = "colorchannelmixer=rr=0:rb=1.25:gg=1.5:gb=0:bb=0:br=0.45"
CLIPS = [
    ("fire-1", (223, 263), "inout", None, 0.03), ("fire-2", (286, 326), "inout", None, 0.03), ("fire-3", (343, 378), "inout", None, 0.03),
    ("laser-1", (9, 46), "inout", CYAN, 0.03), ("laser-2", (503, 558), "pingpong", CYAN, 0.03),
    ("water-1", (845, 911), "pingpong", ORANGE, 0.03), ("water-2", (1110, 1187), "pingpong", ORANGE, 0.12),
]
meta = {}
for name, (s, e), mode, tint, th in CLIPS:
    c = cov[s:e]
    start = s + int(np.argmax(c > th))
    full = s + int(np.argmax(c > 0.98))
    if mode == "inout":
        end = s + len(c) - int(np.argmax(c[::-1] > 0.003))
        cover = (full - start) / FPS
        chain = f"trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS"
    else:
        end = full + 3  # a short hold while fully covered, then the same frames run backwards
        cover = (full - start) / FPS
        chain = (f"trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS,split[f][r];"
                 f"[r]reverse[rv];[f][rv]concat=n=2:v=1:a=0")
    look = (f",{tint}" if tint else "") + ",scale=1280:720:flags=lanczos,colorkey=0x000000:0.04:0.05,format=rgba,split[c][k];[k]alphaextract,dilation,dilation,dilation,dilation,erosion,erosion,erosion,erosion[m];[c][m]alphamerge,format=yuva420p"
    dst = OUT / f"{name}.webm"
    cmd = [str(FF / "ffmpeg.exe"), "-v", "error", "-y", "-i", SRC, "-an", "-filter_complex", f"[0:v]{chain}{look}",
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", str(dst)]
    subprocess.run(cmd, check=True)
    dur = (end - start) / FPS * (2 if mode == "pingpong" else 1)
    meta[name] = {"cover": round(cover, 2), "duration": round(dur, 2), "kb": dst.stat().st_size // 1024}
    print(name, meta[name], flush=True)
(SP / "meta.json").write_text(json.dumps(meta, indent=1))
