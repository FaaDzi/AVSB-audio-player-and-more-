"""Map the YouTube chapter times of the Abyss headphone test onto the lossless WAV.

The WAV (28:48) and the video (25:01) differ in length, so each chapter is located in
the WAV by cross-correlating 10 ms loudness envelopes of both (8 kHz mono f32 dumps).

Usage: python -I scripts/align_abyss.py
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "raw" / "abyss"
SR = 8000
HOP = 80  # 10 ms

CHAPTERS = [  # from the video description
    ("0:00", "Intro", "ES Our Last Stand - FormantX"),
    ("0:24", "Soundstage Test 1", "ES All Will Pass - Alfie Jay Winters"),
    ("2:16", "Soundstage Test 2", "ES Future Explorations - John Barzetti"),
    ("3:14", "Bass Soundstage", "ES Snack Bar - Jobii"),
    ("4:34", "Imaging Test (Directional Accuracy)", ""),
    ("10:42", "Vocal Test 1", "ES For The Brownest Eyes In Town - Arch Tremors"),
    ("12:12", "Vocal Test 2", "ES I Am Better Off [Jazz version] - Wildson"),
    ("14:35", "Vocal Test 3", "ES There's a New Day - Staffan Carlen"),
    ("16:55", "Genre Mixed Electronic", "ES Snowprints - Valante"),
    ("18:34", "Genre Rap", "ES For The Record - Dylan Sitts Remix"),
    ("19:55", "Genre Orchestral", "ES This Creed - Johannes Barnlof"),
    ("22:13", "Explaining the Dynamic Range Test", ""),
    ("23:22", "Dynamic Range test", ""),
    ("24:17", "Ending", "ES Zion - Edgar Hopp"),
]


def secs(t):
    m, s = t.split(":")
    return int(m) * 60 + int(s)


def envelope(x):
    n = len(x) // HOP
    rms = np.sqrt(np.mean(x[: n * HOP].reshape(n, HOP) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    return np.maximum(db, -70)


def ncc_search(needle, hay):
    """Best offset of needle in hay by normalised cross-correlation (FFT)."""
    a = (needle - needle.mean()) / (needle.std() + 1e-9)
    n = len(a)
    size = 1 << int(np.ceil(np.log2(len(hay) + n)))
    corr = np.fft.irfft(np.fft.rfft(hay, size) * np.conj(np.fft.rfft(a, size)), size)[: len(hay) - n + 1]
    c1 = np.cumsum(np.concatenate([[0], hay]))
    c2 = np.cumsum(np.concatenate([[0], hay ** 2]))
    mean = (c1[n:] - c1[:-n]) / n
    std = np.sqrt(np.maximum((c2[n:] - c2[:-n]) / n - mean ** 2, 1e-12))
    score = corr / (n * std)
    i = int(np.argmax(score))
    return i, float(score[i])


def main():
    wav = envelope(np.fromfile(DIR / "wav_8k.f32", dtype=np.float32))
    vid = envelope(np.fromfile(DIR / "vid_8k.f32", dtype=np.float32))
    fps = SR / HOP
    starts = [secs(c[0]) for c in CHAPTERS] + [len(vid) / fps]

    out = []
    for (t, title, music), s, e in zip(CHAPTERS, starts, starts[1:]):
        a, b = int(s * fps), int(e * fps)
        idx, score = ncc_search(vid[a:b], wav)
        out.append({
            "title": title,
            "music": music,
            "videoStart": s,
            "videoEnd": round(e, 2),
            "wavStart": round(idx / fps, 2),
            "wavEnd": round(idx / fps + (e - s), 2),
            "match": round(score, 3),
        })
        print(f"{title:38} video {s:7.1f}-{e:7.1f}  wav {idx / fps:7.1f}-{idx / fps + e - s:7.1f}  match {score:.3f}")
    (DIR / "alignment.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
