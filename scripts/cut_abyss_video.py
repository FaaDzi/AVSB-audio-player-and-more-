"""Cut the downloaded Abyss test video into silent per-chapter clips that follow the lossless audio.

The video is a shorter edit than the lossless album (the imaging test drops the pauses between
sound positions and one long stretch; the intro has no lead-in), so each chapter gets a sync map:
stretches [clip_start, clip_end, video_start] found by matching 4 s pieces of the FLAC against the
video's own soundtrack. The app plays the video while the audio is inside a matched stretch
and holds the frame through the parts the video skipped.

Output: app/public/tests/abyss/video/<id>.mp4 (H.264, 640 px wide, no audio) + video.json.
Usage: python -I scripts/cut_abyss_video.py "<path to the downloaded Abyss video>"
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from align_abyss_video import FFMPEG, SR, locate, pcm  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'app/public/tests/abyss'

# Chapter span in the 25:01 YouTube upload (tezCWPLwu3Q), measured with align_abyss_video.py
REGIONS = {
    'intro': (0.0, 24.0),
    'soundstage-1': (24.0, 136.0),
    'soundstage-2': (136.0, 194.0),
    'bass-soundstage': (194.0, 274.0),
    'imaging': (274.0, 642.04),
    'vocal-1': (642.04, 732.04),
    'vocal-2': (732.04, 875.04),
    'vocal-3': (875.04, 1015.04),
    'electronic': (1015.04, 1114.04),
    'rap': (1114.04, 1195.04),
    'orchestral': (1195.04, 1332.98),
    'dynamic-range-explained': (1332.98, 1401.98),
    'dynamic-range': (1401.98, 1456.98),
    'ending': (1456.98, 1500.98),
}
STEP, WIN, MIN_SCORE, SLACK = 3.0, 4.0, 0.9, 10.0


def segments_for(video: np.ndarray, clip: np.ndarray, v0: float, v1: float) -> list[list[float]]:
    """Matched stretches [clip_start, clip_end, video_start] (video relative to v0), in order.

    Each 4 s piece of the clip is searched only a little ahead of the last match, because the
    video can skip parts of the audio but never runs backwards. Pieces with the same offset
    extend the current stretch.
    """
    out: list[list[float]] = []
    prev_c, prev_v = 0.0, 0.0
    c = 0.0
    dur = len(clip) / SR
    while c + WIN <= dur:
        probe = clip[int(c * SR):int((c + WIN) * SR)]
        if np.linalg.norm(probe) > 1e-2:
            lo = prev_v
            hi = min(v1 - v0, prev_v + (c - prev_c) + SLACK)
            if hi - lo >= WIN:
                seg = video[int((v0 + lo) * SR):int((v0 + hi + WIN) * SR)]
                off, score = locate(seg, probe, 0.0)
                if score >= MIN_SCORE:
                    v = lo + off
                    if out and abs((v - c) - (out[-1][2] - out[-1][0])) <= 0.15:
                        out[-1][1] = round(c + WIN, 2)
                    else:
                        out.append([round(c, 2), round(c + WIN, 2), round(v, 2)])
                    prev_c, prev_v = c, v
        c += STEP
    return out


def main() -> None:
    src = Path(sys.argv[1])
    index = json.loads((OUT / 'index.json').read_text(encoding='utf-8'))
    (OUT / 'video').mkdir(exist_ok=True)
    video = pcm(src)
    result = {}
    for t in index['tracks']:
        v0, v1 = REGIONS[t['id']]
        clip = pcm(ROOT / 'app/public' / t['file'])
        # the dynamic-range test repeats the same tones, so matching is ambiguous; it runs 1:1 with the video
        segments = [[0.0, round(v1 - v0, 2), 0.0]] if t['id'] == 'dynamic-range' else segments_for(video, clip, v0, v1)
        dest = OUT / 'video' / f"{t['id']}.mp4"
        subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(v0), '-to', str(v1), '-i', str(src),
                        '-an', '-vf', 'scale=640:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30',
                        '-movflags', '+faststart', str(dest)], check=True)
        result[t['id']] = {'file': f"tests/abyss/video/{t['id']}.mp4", 'length': round(v1 - v0, 2), 'segments': segments}
        print(f"{t['id']:24s} {dest.stat().st_size / 1e6:5.2f} MB  segments {segments}")
    (OUT / 'video.json').write_text(json.dumps(result, indent=1), encoding='utf-8')
    total = sum((OUT / 'video' / f'{k}.mp4').stat().st_size for k in result) / 1e6
    print(f'total {total:.1f} MB')


if __name__ == '__main__':
    main()
