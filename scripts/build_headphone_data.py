"""Build app/public/data/headphones.json: over-ear / on-ear headphones for the headphone test.

- Sources: AutoEq's over-ear measurements, plus squig.link headphone databases downloaded by
  `fetch_graph_db.py --squig-all --type Headphones` (Crinacle's left out, see the plan §10).
- Reference rig: oratory1990 (GRAS 43AG), whose target is AutoEq's "Harman over-ear 2018".
  Every other source is calibrated onto it with the median difference over models both measured
  (as build_iem_data.py does for IEMs). A source is used only when it shares at least MIN_OVERLAP
  models and, after calibration, its curves sit within MAX_RESIDUAL_DB (median rms, 100 Hz–10 kHz)
  of the reference's: a rig that disagrees model by model can't be fixed by one offset curve.
- The app compares gear by "curve minus target", so each headphone is stored as its difference
  from Harman over-ear 2018 laid onto the in-ear target (Harman in-ear 2019) the IEM data uses:
  fr = in-ear target + (headphone − over-ear target). The tournament, EQ and metrics then work on
  it unchanged, through headphones, IEMs or earbuds alike. `nativeTarget` keeps the over-ear target
  for drawing graphs the way headphone people expect to see them.

Usage: python -I scripts/build_headphone_data.py [--refs]   (--refs: only refresh refs.json, see refs.py)
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
from build_iem_data import BANDS, GRID, align_to, band_mask, load_csv, load_graph_db, slug, smooth
from frcodec import encode
from refs import write_refs
from headphone_types import headphone_type, kitab_types
from names import key

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "autoeq"
SQUIG = ROOT / "data" / "raw" / "squig_dbs" / "Headphones"
SQUIG_5128 = ROOT / "data" / "raw" / "squig_dbs" / "5128"  # B&K 5128 rigs: kept only if they calibrate cleanly
OUT = ROOT / "app" / "public" / "data" / "headphones.json"

REFERENCE = "oratory1990"
# AutoEq sources, priority order (first that has a model wins); squig databases follow.
AUTOEQ = [REFERENCE, "Super Review", "Kuulokenurkka", "Headphone.com Legacy", "Filk", "kr0mka", "Auriculares Argentina",
          "HypetheSonics", "Regan Cipher", "Innerfidelity", "Rtings", "DHRME"]
TARGET_OE = "Harman over-ear 2018"
TARGET_IE = "Harman in-ear 2019"
MIN_OVERLAP = 15
MAX_RESIDUAL_DB = 3.0
FIT = (100, 10000)
# some reviewers keep in-ears in their headphone database ("[IEMs] …", AirPods, "Buds"): not headphones
IN_EAR = re.compile(
    r"^\s*\[(iem|tws|earbud)|\b(airpods(?!\s*max)|earbuds?|buds\d*|tws|in-ear|iems?|wf-?1000\w*|moripods|letsh[uo]{2}er|sals?notes?|7\s*herz\s*zero|kiwi\s*(?:ears\s*)?ke4)\b",
    re.I,
)


def residual(ref: dict, src: dict, shared: list[str]) -> float:
    m = band_mask(*FIT)
    return float(np.median([np.sqrt(np.mean((ref[k] - src[k])[m] ** 2)) for k in shared]))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    t_oe = load_csv(RAW / "targets" / f"{TARGET_OE}.csv")
    t_ie = load_csv(RAW / "targets" / f"{TARGET_IE}.csv")

    curves = {}
    for src in AUTOEQ:
        d = RAW / "measurements" / src / "data" / "over-ear"
        if d.exists():
            curves[src] = {}
            for p in sorted(d.glob("*.csv")):
                try:
                    curves[src][p.stem] = align_to(load_csv(p), t_oe)
                except Exception as e:
                    print(f"skip {src}/{p.name}: {e}")
    squig_sources = []
    folders = [(f, "") for f in sorted(SQUIG.glob("*"))] + [(f, " 5128") for f in sorted(SQUIG_5128.glob("*"))]
    for folder, rig in folders:
        if (folder / "phone_book.json").exists():
            name = f"{folder.name}{rig} (squig.link)"
            curves[name] = {n: align_to(y, t_oe) for n, y in load_graph_db(folder).items()}
            squig_sources.append(name)
    order = AUTOEQ + squig_sources

    ref = {key(n): y for n, y in curves[REFERENCE].items()}
    calibration = {REFERENCE: {"overlap": len(ref), "rmsDb": 0.0, "residualDb": 0.0}}
    for src in order:
        if src not in curves or src == REFERENCE:
            continue
        by_key = {key(n): y for n, y in curves[src].items()}
        shared = sorted(set(ref) & set(by_key))
        if len(shared) < MIN_OVERLAP:
            print(f"drop {src}: only {len(shared)} shared models")
            del curves[src]
            continue
        delta = smooth(np.median([ref[k] - by_key[k] for k in shared], axis=0), 1 / 3)
        delta -= np.mean(delta[band_mask(*FIT)])
        calibrated = {k: y + delta for k, y in by_key.items()}
        res = residual(ref, calibrated, shared)
        if res > MAX_RESIDUAL_DB:
            print(f"drop {src}: residual {res:.2f} dB over {len(shared)} shared models")
            del curves[src]
            continue
        for n in curves[src]:
            curves[src][n] = curves[src][n] + delta
        calibration[src] = {"overlap": len(shared), "rmsDb": round(float(np.sqrt(np.mean(delta ** 2))), 2), "residualDb": round(res, 2)}

    iem_keys = {key(i["name"]) for i in json.loads((ROOT / "app" / "public" / "data" / "iems.json").read_text(encoding="utf-8"))["iems"]}
    for c in curves.values():
        for n in [n for n in c if IN_EAR.search(n) or key(n) in iem_keys]:
            del c[n]
    if "--refs" in sys.argv:  # only the averaged reference curves, for the rows headphones.json already has
        write_refs(json.loads(OUT.read_text(encoding="utf-8"))["iems"], curves, BANDS, band_mask, FIT, lambda y: t_ie + y - t_oe, hp=True)
        return
    keysets = {s: {key(n) for n in c} for s, c in curves.items()}
    old = {}
    if OUT.exists():  # keep ids stable across rebuilds (saved brackets and photos point at them)
        old = {key(h["name"]): h["id"] for h in json.loads(OUT.read_text(encoding="utf-8"))["iems"]}
    phones, seen, ids = [], set(), set(old.values())
    kitab = kitab_types()
    for src in order:
        for name, y in curves.get(src, {}).items():
            k = key(name)
            if k in seen:
                continue
            seen.add(k)
            dev = y - t_oe
            hp_id = old.get(k)
            if not hp_id:
                hp_id = "hp-" + slug(name)
                while hp_id in ids:
                    hp_id += "-2"
                ids.add(hp_id)
            phones.append({
                "id": hp_id,
                "name": name,
                "source": src,
                "sources": [s for s in curves if k in keysets[s]],
                "fr": encode(np.round((t_ie + dev) * 10)),
                "metrics": {b: round(float(np.mean(dev[band_mask(lo, hi)])), 1) for b, (lo, hi) in BANDS.items()},
                **headphone_type(name, kitab),  # "back" / "fit" where known
            })
    phones.sort(key=lambda x: x["name"].lower())

    OUT.write_text(json.dumps({
        "grid": [round(float(f), 2) for f in GRID],
        "frScale": 0.1,
        "target": {"name": TARGET_OE, "fr": [int(round(v * 10)) for v in t_ie]},
        "nativeTarget": {"name": TARGET_OE, "fr": [int(round(v * 10)) for v in t_oe]},
        "bands": BANDS,
        "calibration": calibration,
        "iems": phones,
    }, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{len(phones)} headphones -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
    for s, c in calibration.items():
        print(f"  {s:34} overlap {c['overlap']:4}  rig delta rms {c['rmsDb']:5} dB  residual {c['residualDb']} dB")


if __name__ == "__main__":
    main()
