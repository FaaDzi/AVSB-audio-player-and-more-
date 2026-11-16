"""Build app/public/data/hrir/df.json: how each bundled HRTF's diffuse field differs from the generic one (plan §84 D).

Headphone and IEM targets are defined at the eardrum of one dummy head. A listener whose outer ear differs hears
the same target differently, mostly between 1 and 10 kHz. For every HRIR set in index.json this writes

    delta(f) = that subject's diffuse-field response - the generic set's (HUTUBS pp1, the FABIAN dummy head), in dB

third-octave smoothed, level-matched at 300 Hz-1 kHz, faded to nothing below 1 kHz and above 10 kHz (above that
the measurements and the fit decide, not the ear's shape), and held to +-6 dB. The app adds it to the target.

The ring files themselves are already diffuse-field equalised, so this can't be worked out from them: it needs
the original SOFA files (downloaded once into data/raw/hrtf, like build_hrirs.py does).

    python scripts/build_hrtf_df.py
"""
import json
import urllib.request
from pathlib import Path

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "hrtf"
OUT_DIR = ROOT / "app" / "public" / "data" / "hrir"
URL = "https://sofacoustics.org/data/database/hutubs/pp{n}_HRIRs_measured.sofa"
NFFT = 2048
GRID = [round(500 * 2 ** (i / 6), 1) for i in range(0, 31)]  # 500 Hz .. 16 kHz, sixth octaves
MAX_DB = 6.0


def sofa(n):
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"hutubs_pp{n}_HRIRs_measured.sofa"
    if not path.exists():
        print("downloading", URL.format(n=n))
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(URL.format(n=n), tmp)
        tmp.replace(path)
    return path


def diffuse_field_db(path):
    """The diffuse field (power average over every direction and both ears) in dB on GRID."""
    with h5py.File(path, "r") as f:
        ir = np.asarray(f["Data.IR"][()], dtype=np.float64)
        rate = float(np.asarray(f["Data.SamplingRate"][()]).ravel()[0])
        pos = np.asarray(f["SourcePosition"][()], dtype=np.float64)
    freqs = np.fft.rfftfreq(NFFT, 1 / rate)
    power = np.abs(np.fft.rfft(ir, NFFT, axis=-1)) ** 2
    w = np.maximum(np.cos(np.radians(pos[:, 1])), 0.05)[:, None, None]
    df = np.sum(w * power, axis=(0, 1)) / (np.sum(w) * 2)
    out = []
    for f0 in GRID:
        band = (freqs >= f0 * 2 ** (-1 / 6)) & (freqs <= f0 * 2 ** (1 / 6))
        out.append(10 * np.log10(np.mean(df[band])))
    return np.array(out)


def window():
    """1 inside 1.5-8 kHz, fading to 0 at 1 kHz and 10 kHz... (raised cosine on a log axis)."""
    g = np.array(GRID)
    up = np.clip(np.log(g / 1000) / np.log(1500 / 1000), 0, 1)
    down = np.clip(np.log(10000 / g) / np.log(10000 / 8000), 0, 1)
    return 0.5 * (1 - np.cos(np.pi * np.minimum(up, down)))


def main():
    index = json.loads((OUT_DIR / "index.json").read_text(encoding="utf-8"))
    g = np.array(GRID)
    mid = (g >= 500) & (g <= 1000)
    base = diffuse_field_db(sofa(1))
    win = window()
    sets = {}
    for entry in index:
        if entry["id"] == "generic":
            continue
        n = int(entry["id"].split("-")[1])
        d = diffuse_field_db(sofa(n)) - base
        d -= np.mean(d[mid])
        d = np.clip(d * win, -MAX_DB, MAX_DB)
        sets[entry["id"]] = [round(float(v), 2) for v in d]
        print(f"{entry['id']}: {d.min():+.1f} .. {d.max():+.1f} dB")
    out = OUT_DIR / "df.json"
    out.write_text(json.dumps({"freqs": GRID, "sets": sets}, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{out.relative_to(ROOT)}: {len(sets)} sets")


if __name__ == "__main__":
    main()
