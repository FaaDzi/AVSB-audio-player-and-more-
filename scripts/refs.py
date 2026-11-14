"""Averaged reference curves for the device you listen on (app/public/data/refs.json).

A model measured by several reviewers gets the median of their calibrated curves: one unit on one
rig can be off by a few dB (unit-to-unit variation, fit), and the median evens that out. The spread
says how much the measurements disagree, per band, so the app can tell how far to trust a
simulation on that device. Rows with a single measurement are left out (the app uses `fr`).

Shared file: IEM rows (build_iem_data.py) and headphone rows (build_headphone_data.py, ids "hp-")
each replace only their own entries.
"""
import json
from pathlib import Path

import numpy as np

from frcodec import encode
from names import key

OUT = Path(__file__).resolve().parent.parent / "app" / "public" / "data" / "refs.json"
ALIASES = OUT.parent / "aliases.json"


def merge_groups(rows):
    """id -> the names whose measurements count for it: its own, plus every row aliases.json merges into
    it (the app shows merged duplicates as one model, so its reference should average all of them)."""
    merge = json.loads(ALIASES.read_text(encoding="utf-8")).get("merge", {}) if ALIASES.exists() else {}
    name_of = {r["id"]: r["name"] for r in rows}
    groups = {r["id"]: [r["name"]] for r in rows}
    for dup, target in merge.items():
        if dup in name_of and target in groups and dup != target:
            groups[target].append(name_of[dup])
    return groups


def write_refs(rows, curves, bands, band_mask, fit_band, to_stored=lambda y: y, hp=False):
    """rows: [{id, name}]; curves: source -> {name: calibrated dB on GRID}; to_stored maps a curve to how
    the catalog stores it (headphones: onto the in-ear target)."""
    by_key = {s: {key(n): y for n, y in c.items()} for s, c in curves.items()}
    lo, hi = fit_band
    groups = merge_groups(rows)
    out = {}
    for r in rows:
        # every (source, name) pair once: the same measurement listed under two names isn't two units
        ks = list(dict.fromkeys(key(n) for n in groups[r["id"]]))
        ys = [b[k] for b in by_key.values() for k in ks if k in b]
        if len(ys) < 2:
            continue
        ys = np.array(ys)
        med = np.median(ys, axis=0)
        dev = ys - med
        out[r["id"]] = {
            "fr": encode(np.round(to_stored(med) * 10)),
            "n": len(ys),
            # median rms disagreement with the median curve over the fit band, and per band a robust
            # sigma (scaled median absolute deviation), so one odd unit among 40 doesn't set it
            "rmsDb": round(float(np.median(np.sqrt(np.mean(dev[:, band_mask(lo, hi)] ** 2, axis=1)))), 1),
            "spread": {b: round(float(np.median(np.abs(dev[:, band_mask(a, z)].mean(axis=1))) * (1.4826 if len(ys) > 2 else 1)), 1)
                       for b, (a, z) in bands.items()},
        }
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    keep = {i: v for i, v in old.items() if i.startswith("hp-") != hp}
    OUT.write_text(json.dumps({**keep, **out}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{len(out)} {'headphone' if hp else 'IEM'} rows with an averaged reference -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
