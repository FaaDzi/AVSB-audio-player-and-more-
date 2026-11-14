"""
Build app/public/data/targets.json: the target curves the frequency graph can draw.

- Harman in-ear 2019 comes from AutoEq (the target every IEM curve is aligned to).
- JM-1 DF and IEF Neutral 2023 / 2020 are the squig.link target files from kr0mka.squig.link
  (data/targets/<name> Target.txt), saved under data/raw/targets/.
- "JM-1 + tilt" is JM-1 DF with squig.link's default custom tilt: -0.8 dB/octave and a
  +5 dB low shelf at 105 Hz (Q 0.707), computed the same way squig's graphtool does.
- "IEF 2025" is Crinacle's 2025 definition: JM-1 DF + a +10 dB low shelf at 80 Hz (Q 0.71)
  and a −4 dB high shelf at 2.5 kHz (Q 0.4) (crinacle.com/2025/02/05/the-new-2025-ief-target/).

Each target is put on the shared grid and level-aligned to Harman over 100 Hz-10 kHz, like
the IEM curves, so they all sit on the same graph.
"""
import json

import numpy as np

from build_iem_data import ALIGN, GRID, RAW, ROOT, TARGET, align_to, load_csv

SQUIG = ROOT / "data" / "raw" / "targets"
OUT = ROOT / "app" / "public" / "data" / "targets.json"


def load_squig(name: str) -> np.ndarray:
    """A squig.link target file on GRID, minus junk end points (IEF 2020 ends in a 0 dB row)."""
    rows = []
    for line in (SQUIG / f"{name}.txt").read_text(encoding="utf-8").splitlines():
        parts = line.replace(",", " ").split()
        if len(parts) >= 2 and not line.startswith("*"):
            rows.append((float(parts[0]), float(parts[1])))
    f, db = np.array(rows).T
    ok = (f > 0) & (np.abs(db - np.median(db)) < 40)
    return np.interp(np.log(GRID), np.log(f[ok]), db[ok])


def low_shelf_db(freq: float, gain: float, q: float = 0.707, fs: float = 48000) -> np.ndarray:
    """RBJ cookbook low shelf, magnitude in dB on GRID."""
    a = 10 ** (gain / 40)
    w0 = 2 * np.pi * freq / fs
    alpha = np.sin(w0) / (2 * q)
    c, s = np.cos(w0), 2 * np.sqrt(a) * alpha
    b = [a * ((a + 1) - (a - 1) * c + s), 2 * a * ((a - 1) - (a + 1) * c), a * ((a + 1) - (a - 1) * c - s)]
    d = [(a + 1) + (a - 1) * c + s, -2 * ((a - 1) + (a + 1) * c), (a + 1) + (a - 1) * c - s]
    z = np.exp(-1j * 2 * np.pi * GRID / fs)
    h = (b[0] + b[1] * z + b[2] * z**2) / (d[0] + d[1] * z + d[2] * z**2)
    return 20 * np.log10(np.abs(h))


def high_shelf_db(freq: float, gain: float, q: float = 0.707, fs: float = 48000) -> np.ndarray:
    """RBJ cookbook high shelf, magnitude in dB on GRID."""
    a = 10 ** (gain / 40)
    w0 = 2 * np.pi * freq / fs
    alpha = np.sin(w0) / (2 * q)
    c, s = np.cos(w0), 2 * np.sqrt(a) * alpha
    b = [a * ((a + 1) + (a - 1) * c + s), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - s)]
    d = [(a + 1) - (a - 1) * c + s, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - s]
    z = np.exp(-1j * 2 * np.pi * GRID / fs)
    h = (b[0] + b[1] * z + b[2] * z**2) / (d[0] + d[1] * z + d[2] * z**2)
    return 20 * np.log10(np.abs(h))


def main():
    harman = load_csv(RAW / "targets" / f"{TARGET}.csv")
    jm1 = load_squig("JM-1 DF")
    targets = [
        (TARGET, "Harman's 2019 in-ear preference research", harman),
        ("JM-1", "JM-1 diffuse field, the neutral baseline most squig.link sites use", jm1),
        ("JM-1 + tilt", "JM-1 with squig's default tilt: −0.8 dB/oct and +5 dB bass shelf", jm1 - 0.8 * np.log2(GRID) + low_shelf_db(105, 5)),
        ("IEF Neutral 2023", "Crinacle's In-Ear Fidelity neutral target (2023)", load_squig("IEF Neutral 2023")),
        ("IEF 2025", "Crinacle's 2025 target: JM-1 with a big sub-bass shelf and softer treble",
         jm1 + low_shelf_db(80, 10, 0.71) + high_shelf_db(2500, -4, 0.4)),
        ("IEF Neutral 2020", "Crinacle's earlier In-Ear Fidelity neutral target", load_squig("IEF Neutral 2020")),
    ]
    # headphones are graphed in their own over-ear shape, so they get over-ear targets measured on
    # the GRAS 43AG rig their curves are aligned to (build_headphone_data.py), levelled to Harman OE 2018
    oe = load_csv(RAW / "targets" / "Harman over-ear 2018.csv")
    hp_targets = [
        ("Harman over-ear 2018", "Harman's 2018 over-ear preference research, open or closed back", oe),
        ("Harman OE 2018 no bass", "Harman over-ear 2018 without its bass shelf", load_csv(RAW / "targets" / "Harman over-ear 2018 without bass.csv")),
        ("Harman over-ear 2015", "Harman's 2015 over-ear target", load_csv(RAW / "targets" / "Harman over-ear 2015.csv")),
        ("Harman over-ear 2013", "Harman's first over-ear target (2013)", load_csv(RAW / "targets" / "Harman over-ear 2013.csv")),
        ("oratory1990 optimum", "oratory1990's optimum hi-fi over-ear target, popular in the EQ community", load_csv(RAW / "targets" / "oratory1990 optimum hifi over-ear.csv")),
        ("Diffuse field", "Diffuse field (GRAS KEMAR): the neutral headphone baseline", load_csv(RAW / "targets" / "Diffuse field GRAS KEMAR.csv")),
    ]
    out = {
        "targets": [
            {"name": n, "note": note, "fr": [int(round(v * 10)) for v in align_to(y, harman)]}
            for n, note, y in targets
        ],
        "headphoneTargets": [
            {"name": n, "note": note, "fr": [int(round(v * 10)) for v in align_to(y, oe)]}
            for n, note, y in hp_targets
        ],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(targets)} targets + {len(hp_targets)} headphone targets to {OUT} (aligned {ALIGN[0]}-{ALIGN[1]} Hz)")


if __name__ == "__main__":
    main()
