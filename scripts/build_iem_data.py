"""Build app/public/data/iems.json from the AutoEq in-ear measurements.

- Resamples every FR to a shared 1/24-octave grid (20 Hz - 20 kHz).
- Calibrates other reviewers' rigs onto the reference source (Super Review) using the
  median difference over IEMs both have measured, so curves are comparable.
- Aligns each curve to the Harman in-ear 2019 target and computes tonal band metrics.
- squig.link databases downloaded by `fetch_graph_db.py --squig-all` (data/raw/squig_dbs/IEMs)
  join after the hand-picked sources: Super Review's own database refreshes the reference, and
  any other site is used only if it shares SQUIG_MIN_OVERLAP IEMs with the reference and its
  curves, once calibrated, sit within MAX_RESIDUAL_DB of the reference's (median rms 100 Hz–10 kHz).
- Ids already in iems.json are kept (reviews, photos, prices and saved brackets point at them).

Usage: python -I scripts/build_iem_data.py [--refs]   (--refs: only refresh refs.json, see refs.py)
"""
import json
from collections import defaultdict
import sys
import re
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
from frcodec import encode
from refs import write_refs
from names import ALIASES, key

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "autoeq"
OUT = ROOT / "app" / "public" / "data" / "iems.json"

# Graph-tool databases downloaded by scripts/fetch_graph_db.py.
# Jay Audio's own units are the ones his ranking sheet describes, so they come first.
GRAPH_DBS = {
    "Jay Audio (jaysaudio.github.io)": ROOT / "data" / "raw" / "jaysaudio",
    "Jaytiss (squig.link)": ROOT / "data" / "raw" / "jaytiss",
}
JAY_AUDIO = "Jay Audio (jaysaudio.github.io)"
REFERENCE = "Super Review"   # rig every other source is calibrated onto
# Priority order: first source that has an IEM wins.
SOURCES = [JAY_AUDIO, "Super Review", "Jaytiss (squig.link)", "Jaytiss", "ToneDeafMonk", "Hi End Portable", "Harpo",
           "RikudouGoku", "Kazi", "Fahryst", "Regan Cipher", "kr0mka", "Bakkwatan",
           "freeryder05", "Filk", "DHRME"]
MIN_OVERLAP = 20          # minimum shared IEMs needed to calibrate a source
SQUIG = ROOT / "data" / "raw" / "squig_dbs" / "IEMs"
SQUIG_REFERENCE = "superreview"   # Super Review's own squig.link database: the reference rig
SQUIG_SKIP = {"jaytiss"}          # already a source above
SQUIG_MIN_OVERLAP = 40
MAX_RESIDUAL_DB = 2.5
MAX_VARIANTS = 12   # new tip/switch/filter variants kept per model (rows already in iems.json always stay)
TARGET = "Harman in-ear 2019"

GRID = 20 * 2 ** (np.arange(0, 24 * np.log2(20000 / 20) + 1) / 24)
BANDS = {                 # name: (lo Hz, hi Hz)
    "subBass": (20, 60),
    "midBass": (60, 250),
    "lowerMids": (250, 1000),
    "upperMids": (1000, 4000),
    "lowerTreble": (4000, 8000),
    "air": (8000, 16000),
}
ALIGN = (100, 10000)      # band used to level-align a curve to the target


def load_csv(path: Path) -> np.ndarray:
    data = np.genfromtxt(path, delimiter=",", names=True)
    f, raw = data["frequency"], data["raw"]
    ok = np.isfinite(raw) & (f > 0)
    return np.interp(np.log(GRID), np.log(f[ok]), raw[ok])


def load_rew(path: Path) -> np.ndarray:
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.replace(",", " ").split()
        if len(parts) >= 2 and not line.startswith("*"):
            try:
                rows.append((float(parts[0]), float(parts[1])))
            except ValueError:
                pass
    f, db = np.array(rows).T
    ok = (f > 0) & np.isfinite(db)
    return np.interp(np.log(GRID), np.log(f[ok]), db[ok])


def load_graph_db(folder: Path):
    """{display name: curve} from a graph-tool phone book; L/R averaged; extra files become variants."""
    book = json.loads((folder / "phone_book.json").read_text(encoding="utf-8"))
    out = {}
    for brand in book:
        for phone in brand.get("phones", []) if isinstance(brand, dict) else []:
            if not isinstance(phone, dict) or not phone.get("file"):
                continue  # a malformed entry in someone's phone book
            files = phone["file"] if isinstance(phone["file"], list) else [phone["file"]]
            name = f"{brand.get('name', '')} {phone.get('name', '')}".strip()
            for i, f in enumerate(files):
                chans = []
                for ch in ("L", "R"):
                    if (p := folder / "fr" / f"{f} {ch}.txt").exists():
                        try:
                            chans.append(load_rew(p))
                        except ValueError:  # an empty or garbled file on someone's site
                            pass
                if chans:
                    out[name if i == 0 else f"{name} ({f})"] = np.mean(chans, axis=0)
    return out


def smooth(y: np.ndarray, octaves: float) -> np.ndarray:
    k = max(1, int(round(octaves * 24 / 2)))
    pad = np.pad(y, k, mode="edge")
    return np.convolve(pad, np.ones(2 * k + 1) / (2 * k + 1), mode="valid")


def band_mask(lo, hi):
    return (GRID >= lo) & (GRID < hi)


def align_to(y, target):
    m = band_mask(*ALIGN)
    return y - np.mean((y - target)[m])


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def loose(name: str) -> str:
    """Order-free key, so a collab written either way round ("QoA x 7th Acoustics Ryusei" /
    "7th Acoustics x QoA Ryusei") is one IEM. Only the model words are order-free: a variant in
    brackets ("(off-on-off)") must match exactly, or switch settings would merge."""
    words = key_words(re.sub(r"\s*\(.*?\)", "", name))
    variant = "".join(re.findall(r"\((.*?)\)", key_words(name)))
    return " ".join(sorted(t for t in re.findall(r"[a-z0-9]+", words) if t != "x")) + "|" + re.sub(r"[^a-z0-9]", "", variant)


def junk_name(name: str) -> bool:
    """A phone-book entry with no real model name ("1", "B (breeze)", "------- ---", "(UIEM - AK)"):
    some squig sites leave the brand and model out and keep only a file tag."""
    return sum(c.isalpha() for c in re.sub(r"\s*\(.*?\)", "", name)) < 2  # any script: "忘夜 20" is a model


# Full-size headphones some IEM reviewers also measured on their in-ear rig. They belong to the
# headphone catalog (headphones.json), not to IEM or TWS brackets.
HEADPHONES_ON_IEM_RIGS = {
    "Aune SR7000", "Austrian Audio The Composer", "Beyerdynamic Custom One Pro", "Fiio FT1", "HarmonicDyne ATHENA",
    "Hifiman Arya Stealth", "HIFIMAN EDITION XS", "Hifiman HE400SE", "Hifiman He6seV2", "Hifiman Susvara",
    "Hifiman Susvara Unveiled", "Moondrop Cosmo", "MOONDROP JOKER", "Moondrop Laputa", "Moondrop Para",
    "Moondrop Para 2", "Moondrop Venus", "Sennheiser HD 600", "Sennheiser HD620s", "Sennheiser HD660s2",
    "Sennheiser HD800s", "Sony MDR-7506", "Sony MDR-M1", "Sony MDR-MV1", "ZMF Atrium", "ZMF Atrium Closed",
}
# Not headphones or in-ears at all: a reviewer's own speaker ("My Q350" = KEF Q350).
SPEAKERS_ON_IEM_RIGS = {"My Q350"}


def headphone_name(name: str) -> bool:
    """A row that isn't an in-ear: a headphone or speaker some IEM reviewer measured."""
    model = name.split("(")[0].strip().lower()  # nested brackets: "X (Susvara U (IEC711))"
    return model in {n.lower() for n in HEADPHONES_ON_IEM_RIGS | SPEAKERS_ON_IEM_RIGS}


def key_words(name: str) -> str:
    s = name.lower()
    for rx, rep in ALIASES:
        s = re.sub(rx, rep, s)
    return s


def main():
    target = load_csv(RAW / "targets" / f"{TARGET}.csv")

    curves = {}           # source -> {name: aligned curve}
    for src in SOURCES:
        if src in GRAPH_DBS:
            if (GRAPH_DBS[src] / "phone_book.json").exists():
                curves[src] = {n: align_to(y, target) for n, y in load_graph_db(GRAPH_DBS[src]).items()}
            continue
            continue
        d = RAW / "measurements" / src / "data" / "in-ear"
        if not d.exists():
            continue
        curves[src] = {}
        for p in sorted(d.glob("*.csv")):
            try:
                curves[src][p.stem] = align_to(load_csv(p), target)
            except Exception as e:  # malformed file: skip, report
                print(f"skip {src}/{p.name}: {e}")

    # Super Review's squig database is the same rig as the AutoEq copy: newer graphs refresh it
    if (SQUIG / SQUIG_REFERENCE / "phone_book.json").exists():
        for n, y in load_graph_db(SQUIG / SQUIG_REFERENCE).items():
            curves[REFERENCE][n] = align_to(y, target)
    squig_sources = []
    for folder in sorted(SQUIG.glob("*")) if SQUIG.exists() else []:
        if folder.name in SQUIG_SKIP | {SQUIG_REFERENCE} or not (folder / "phone_book.json").exists():
            continue
        try:
            got = load_graph_db(folder)
        except Exception as e:  # a malformed phone book: skip the site, report
            print(f"skip squig {folder.name}: {e}")
            continue
        if got:
            name = f"{folder.name} (squig.link)"
            curves[name] = {n: align_to(y, target) for n, y in got.items()}
            squig_sources.append(name)

    ref = {key(n): y for n, y in curves[REFERENCE].items()}
    calibration = {REFERENCE: {"overlap": len(ref), "rmsDb": 0.0, "residualDb": 0.0}}
    fit = band_mask(100, 10000)
    for src in SOURCES + squig_sources:
        if src not in curves or src == REFERENCE:
            continue
        by_key = {key(n): y for n, y in curves[src].items()}
        shared = sorted(set(ref) & set(by_key))
        squig = src in squig_sources
        if len(shared) < (SQUIG_MIN_OVERLAP if squig else MIN_OVERLAP):
            print(f"drop {src}: only {len(shared)} shared IEMs")
            del curves[src]
            continue
        delta = smooth(np.median([ref[k] - by_key[k] for k in shared], axis=0), 1 / 3)
        delta -= np.mean(delta[band_mask(*ALIGN)])
        residual = float(np.median([np.sqrt(np.mean((ref[k] - by_key[k] - delta)[fit] ** 2)) for k in shared]))
        if squig and residual > MAX_RESIDUAL_DB:
            print(f"drop {src}: residual {residual:.2f} dB over {len(shared)} shared IEMs")
            del curves[src]
            continue
        for n in curves[src]:
            curves[src][n] = curves[src][n] + delta
        calibration[src] = {"overlap": len(shared), "rmsDb": round(float(np.sqrt(np.mean(delta ** 2))), 2),
                            "residualDb": round(residual, 2)}
    # squig sites after the hand-picked ones, best-agreeing rig first
    squig_sources.sort(key=lambda s: calibration[s]["residualDb"] if s in calibration else 99)

    if "--refs" in sys.argv:  # only the averaged reference curves, for the rows iems.json already has
        write_refs(json.loads(OUT.read_text(encoding="utf-8"))["iems"], curves, BANDS, band_mask, (100, 10000))
        return
    keysets = {s: {key(n) for n in c} for s, c in curves.items()}
    old, old_loose = {}, {}
    if OUT.exists():
        prev = json.loads(OUT.read_text(encoding="utf-8"))["iems"]
        old = {key(i["name"]): i["id"] for i in prev}
        old_loose = {loose(i["name"]): i["id"] for i in prev}
    iems, seen, seen_loose, ids = [], set(), set(), set(old.values())
    per_model = defaultdict(int)
    for src in SOURCES + squig_sources:
        for name, y in curves.get(src, {}).items():
            if junk_name(name) or headphone_name(name):
                continue
            # existing rows stay as they are (scripts/build_iem_aliases.py merges their duplicates)
            if key(name) in seen or (key(name) not in old and loose(name) in seen_loose):
                continue
            model = key(re.sub(r"\s*\(.*?\)", "", name))
            if key(name) not in old and per_model[model] >= MAX_VARIANTS:
                continue  # higher-priority sources came first, so their variants are the ones kept
            per_model[model] += 1
            seen.add(key(name))
            seen_loose.add(loose(name))
            dev = y - target
            # the same IEM spelled another way keeps its id too
            iem_id = old.get(key(name)) or old_loose.get(loose(name))
            if not iem_id:
                iem_id = slug(name)
                while iem_id in ids:
                    iem_id += "-2"
                ids.add(iem_id)
            iems.append({
                "id": iem_id,
                "name": name,
                "source": src,
                "sources": [s for s in curves if key(name) in keysets[s]],
                "fr": encode(np.round(y * 10)),
                "metrics": {b: round(float(np.mean(dev[band_mask(lo, hi)])), 1) for b, (lo, hi) in BANDS.items()},
            })
    iems.sort(key=lambda x: x["name"].lower())

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "grid": [round(float(f), 2) for f in GRID],
        "frScale": 0.1,
        "target": {"name": TARGET, "fr": [int(round(v * 10)) for v in target]},
        "bands": BANDS,
        "calibration": calibration,
        "iems": iems,
    }, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    print(f"{len(iems)} IEMs, {len(GRID)} points -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
    for s, c in calibration.items():
        print(f"  {s:34} overlap {c['overlap']:4}  rig delta rms {c['rmsDb']:5} dB  residual {c.get('residualDb', '-')} dB")


if __name__ == "__main__":
    main()
