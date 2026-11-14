"""Find where each lossless Abyss test clip sits in the downloaded YouTube video.

Cross-correlates the start and the end of every clip (mono, 4 kHz) against the
video's audio, so the video can be cut to match the clips exactly.
Writes .cache/abyss/align.json: {id: {start, end_from_tail, score_head, score_tail}}.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / 'tools/ffmpeg/bin/ffmpeg.exe'
SR = 4000
WIN = 20.0  # seconds of clip used for matching
SEARCH = 240.0  # seconds either side of the YouTube timestamp


def pcm(path: Path) -> np.ndarray:
    raw = subprocess.run([str(FFMPEG), '-loglevel', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def locate(video: np.ndarray, probe: np.ndarray, centre: float) -> tuple[float, float]:
    """Best offset (s) of probe in video near centre, and normalised correlation score."""
    lo = max(0, int((centre - SEARCH) * SR))
    hi = min(len(video), int((centre + SEARCH) * SR) + len(probe))
    seg = video[lo:hi]
    n = 1 << int(np.ceil(np.log2(len(seg) + len(probe))))
    corr = np.fft.irfft(np.fft.rfft(seg, n) * np.conj(np.fft.rfft(probe, n)), n)[: len(seg) - len(probe) + 1]
    csum = np.concatenate(([0.0], np.cumsum(seg.astype(np.float64) ** 2)))
    energy = np.sqrt(np.maximum(csum[len(probe):] - csum[: -len(probe)], 0)) * np.linalg.norm(probe) + 1e-9
    score = corr / energy
    i = int(np.argmax(score))
    return (lo + i) / SR, float(score[i])


def main() -> None:
    video_path = Path(sys.argv[1])
    index = json.loads((ROOT / 'app/public/tests/abyss/index.json').read_text(encoding='utf-8'))
    video = pcm(video_path)
    out = {}
    for t in index['tracks']:
        clip = pcm(ROOT / 'app/public' / t['file'])
        dur = len(clip) / SR
        yt = sum(int(x) * 60 ** i for i, x in enumerate(reversed(t['youtube'].split(':'))))
        w = int(min(WIN, dur / 2) * SR)
        head, sh = locate(video, clip[:w], yt)
        tail, st = locate(video, clip[-w:], head + dur - w / SR)
        end = tail + w / SR
        out[t['id']] = {'start': round(head, 3), 'end': round(end, 3), 'clip': round(dur, 3), 'score_head': round(sh, 3), 'score_tail': round(st, 3)}
        print(f"{t['id']:24s} start {head:8.2f}  end {end:8.2f}  video-len {end - head:7.2f}  clip {dur:7.2f}  match {sh:.2f}/{st:.2f}")
    (ROOT / '.cache/abyss/align.json').write_text(json.dumps(out, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
