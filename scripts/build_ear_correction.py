"""app/public/data/hrir/ear_correction.json: the tone correction the spatial mode's virtual path uses.

The app's targets (Harman) already contain the outer ear's resonance and a bass shelf. The HRIRs add the
outer ear again for the virtual speakers, so on top of a Harman-tuned sound the ear is counted twice: the
speakers come out forward, boomy and stuck inside the head. Diffuse field − Harman over-ear 2018 (both in
targets.json, same rig and grid) turns a Harman-tuned sound into the diffuse-field one the HRIRs expect.

Shaped for listening: 0 dB at 1 kHz, limited to ±8 dB, tapered to 0 dB from 10 to 12 kHz (above that the
two curves part fast and the HRIRs themselves are rough), on a 1/12-octave grid. The app fits a few
biquads to it (spatial/earCorrection.ts).

Usage: python -I scripts/build_ear_correction.py
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "public" / "data"
OUT = DATA / "hrir" / "ear_correction.json"
LIMIT_DB = 8.0
TAPER = (10000.0, 12000.0)


def interp(grid, vals, f):
    if f <= grid[0]:
        return vals[0]
    for i in range(1, len(grid)):
        if grid[i] >= f:
            t = math.log(f / grid[i - 1]) / math.log(grid[i] / grid[i - 1])
            return vals[i - 1] + t * (vals[i] - vals[i - 1])
    return vals[-1]


def main():
    iems = json.loads((DATA / "iems.json").read_text(encoding="utf-8"))
    targets = json.loads((DATA / "targets.json").read_text(encoding="utf-8"))
    grid, scale = iems["grid"], iems["frScale"]
    hp = {t["name"]: t["fr"] for t in targets["headphoneTargets"]}
    diff = [(a - b) * scale for a, b in zip(hp["Diffuse field"], hp["Harman over-ear 2018"])]
    freqs = [20 * 2 ** (k / 12) for k in range(int(12 * math.log2(20000 / 20)) + 1)]
    at1k = interp(grid, diff, 1000)
    db = []
    for f in freqs:
        v = max(-LIMIT_DB, min(LIMIT_DB, interp(grid, diff, f) - at1k))
        if f >= TAPER[1]:
            v = 0.0
        elif f > TAPER[0]:
            x = math.log(f / TAPER[0]) / math.log(TAPER[1] / TAPER[0])
            v *= 0.5 + 0.5 * math.cos(math.pi * x)
        db.append(round(v, 2))
    OUT.write_text(json.dumps({
        "note": "Diffuse field − Harman over-ear 2018 (targets.json): Harman-tuned sound → the diffuse-field sound HRIRs expect",
        "freqs": [round(f, 2) for f in freqs],
        "db": db,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(freqs)} points; 50 Hz {interp(freqs, db, 50):+.1f} dB, "
          f"3 kHz {interp(freqs, db, 3000):+.1f} dB, 10 kHz {interp(freqs, db, 10000):+.1f} dB")


if __name__ == "__main__":
    main()
