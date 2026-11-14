"""
Build app/public/data/hrir/generic.json: the bundled HRIR ring for spatial mode (plan §32 phase 2).

One listener from an open SOFA dataset, horizontal plane only (elevation 0), one HRIR pair every
5° (interpolated when the set's grid is coarser), diffuse-field equalised so the outer-ear
resonance isn't counted twice on top of an IEM target (the app's targets already include it):

  diffuse field = RMS-average magnitude over every measured direction and both ears
                  (weighted by cos(elevation), so the dense poles don't dominate),
                  smoothed to 1/3 octave, flat below 150 Hz and above 16 kHz
  equaliser     = minimum-phase inverse of it, gain limited to ±15 dB

Then each HRIR is trimmed to start just before the earliest onset of the ring (the ITD stays),
cut to TAPS samples at 48 kHz with a short fade-out, and stored as base64 little-endian Float32.

Sources (raw downloads go to data/raw/hrtf/):
  hutubs (default): HUTUBS, subject pp1, measured (44.1 kHz, 10° ring). CC BY 4.0.
  sonicom:          SONICOM HRTF dataset, subject P0001, 48 kHz free-field compensated. Not shipped:
                    its SOFA files carry a CC BY-SA 3.0 licence attribute that conflicts with the MIT
                    one on the website, so the app uses HUTUBS only.

With hutubs it also writes the candidates for "Pick your HRTF by ear" (plan §32 phase 3):
app/public/data/hrir/hutubs-<n>.json for CANDIDATES more HUTUBS subjects, plus index.json listing
generic + those. The candidates are picked to be spread out by how they sound rather than by
anthropometry (a separate download, and only indirectly tied to the sound): every subject with a measured set is built
exactly like generic, described by its third-octave levels (1–16 kHz, where individual ears
differ) at every ring direction and both ears, in dB, and then picked by farthest-point sampling,
starting from pp1: each next candidate is the subject whose RMS dB distance to the nearest
already-picked one is largest. So the bracket covers the spread of the database in few sets.
Far outliers (median distance to the others above Q3 + 3 IQR; pp33 and pp48 in practice) are left
out first, since farthest-point sampling would otherwise pick likely measurement problems.

Usage: python scripts/build_hrirs.py [hutubs|sonicom]
Needs numpy and h5py (pip install --user h5py).
"""
import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "hrtf"
OUT_DIR = ROOT / "app" / "public" / "data" / "hrir"
OUT = OUT_DIR / "generic.json"

HUTUBS_URL = "https://sofacoustics.org/data/database/hutubs/pp{n}_HRIRs_measured.sofa"
HUTUBS_SUBJECTS = range(1, 97)
CANDIDATES = 15  # + generic = 16 sets
GROUPS = 4  # picked in two rounds: 4 group heads, then the winner's group of 4 (6 picks in all)


def hutubs_source(n):
    return {
        "url": HUTUBS_URL.format(n=n),
        "file": f"hutubs_pp{n}_HRIRs_measured.sofa",
        "name": f"HUTUBS pp{n}",
        "source": f"HUTUBS (TU Berlin), CC BY 4.0; subject pp{n}, measured, diffuse-field equalised",
    }


SOURCES = {
    "sonicom": {
        "url": "https://transfer.ic.ac.uk:9090/2022_SONICOM-HRTF-DATASET/P0001/HRTF/HRTF/48kHz/P0001_FreeFieldComp_48kHz.sofa",
        "file": "P0001_FreeFieldComp_48kHz.sofa",
        "name": "Generic (SONICOM P0001)",
        "source": "SONICOM HRTF dataset (Imperial College London), subject P0001; diffuse-field equalised",
    },
    "hutubs": {**hutubs_source(1), "name": "Generic (HUTUBS pp1)"},
}

RATE = 48000
STEP = 5
TAPS = 256
NFFT = 1024
PRE = 4  # samples kept before the earliest onset
FADE = 32
MAX_EQ_DB = 15.0


def download(src):
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / src["file"]
    if not path.exists():
        print("downloading", src["url"])
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(src["url"], tmp)
        tmp.replace(path)
    return path


def load_sofa(path):
    with h5py.File(path, "r") as f:
        ir = np.asarray(f["Data.IR"][()], dtype=np.float64)  # (M, 2, N): receivers 0 = left, 1 = right
        rate = float(np.asarray(f["Data.SamplingRate"][()]).ravel()[0])
        pos = np.asarray(f["SourcePosition"][()], dtype=np.float64)  # azimuth, elevation (deg), distance
    return ir, rate, pos


def resample(x, rate_from, rate_to):
    """FFT resampling along the last axis (the HRIRs are short, so the circular wrap is harmless)."""
    if rate_from == rate_to:
        return x
    n = x.shape[-1]
    m = int(round(n * rate_to / rate_from))
    spec = np.fft.rfft(x, axis=-1)
    keep = min(spec.shape[-1], m // 2 + 1)
    out = np.zeros(x.shape[:-1] + (m // 2 + 1,), dtype=complex)
    out[..., :keep] = spec[..., :keep]
    return np.fft.irfft(out, m, axis=-1) * (m / n)


def third_octave_smooth(freqs, mag):
    out = np.empty_like(mag)
    for i, f in enumerate(freqs):
        if f <= 0:
            out[i] = mag[i]
            continue
        band = (freqs >= f * 2 ** (-1 / 6)) & (freqs <= f * 2 ** (1 / 6))
        out[i] = np.sqrt(np.mean(mag[band] ** 2))
    return out


def min_phase(mag):
    """Minimum-phase impulse response with magnitude `mag` (rfft bins of an NFFT-point spectrum)."""
    n = (len(mag) - 1) * 2
    cep = np.fft.irfft(np.log(np.maximum(mag, 1e-8)), n)
    fold = np.zeros(n)
    fold[0] = cep[0]
    fold[1 : n // 2] = 2 * cep[1 : n // 2]
    fold[n // 2] = cep[n // 2]
    return np.fft.irfft(np.exp(np.fft.rfft(fold)), n)


def diffuse_field_eq(ir, pos, rate):
    freqs = np.fft.rfftfreq(NFFT, 1 / rate)
    spec = np.abs(np.fft.rfft(ir, NFFT, axis=-1))  # (M, 2, bins)
    w = np.cos(np.radians(pos[:, 1]))
    w = np.maximum(w, 0.05)[:, None, None]
    df = np.sqrt(np.sum(w * spec**2, axis=(0, 1)) / (np.sum(w) * 2))
    df = third_octave_smooth(freqs, df)
    # the measurements aren't trustworthy at the extremes: hold the diffuse field flat there
    lo = np.searchsorted(freqs, 150)
    hi = np.searchsorted(freqs, 16000)
    df[:lo] = df[lo]
    df[hi:] = df[hi]
    df /= np.sqrt(np.mean(df[lo:hi] ** 2))
    inv_db = np.clip(-20 * np.log10(df), -MAX_EQ_DB, MAX_EQ_DB)
    return min_phase(10 ** (inv_db / 20))


def ring_at(ir, pos, az):
    """The elevation-0 HRIR pair at azimuth `az`, linearly interpolated between the nearest measured ones."""
    e0 = np.abs(pos[:, 1]) < 0.5
    idx = np.where(e0)[0]
    azs = np.mod(pos[idx, 0], 360)
    order = np.argsort(azs)
    idx, azs = idx[order], azs[order]
    exact = np.where(np.abs(azs - az) < 1e-6)[0]
    if exact.size:
        return ir[idx[exact[0]]]
    hi = np.searchsorted(azs, az) % len(azs)
    lo = (hi - 1) % len(azs)
    span = (azs[hi] - azs[lo]) % 360
    t = ((az - azs[lo]) % 360) / span
    # crude time alignment would be nicer, but at a 10° spacing plain linear mixing is acceptable
    return (1 - t) * ir[idx[lo]] + t * ir[idx[hi]]


def onset(x, frac=0.2):
    a = np.abs(x)
    return int(np.argmax(a >= frac * a.max()))


def b64(x):
    return base64.b64encode(np.asarray(x, dtype="<f4").tobytes()).decode("ascii")


def build_ring(path):
    """The finished ring (72, 2, TAPS) for one SOFA file."""
    ir, rate, pos = load_sofa(path)
    ir = resample(ir, rate, RATE)
    eq = diffuse_field_eq(ir, pos, RATE)
    ring = np.stack([ring_at(ir, pos, az) for az in range(0, 360, STEP)])  # (72, 2, N)
    n = ring.shape[-1]
    ring = np.fft.irfft(np.fft.rfft(ring, NFFT + n, axis=-1) * np.fft.rfft(eq, NFFT + n), NFFT + n, axis=-1)
    start = max(0, min(onset(ring[i, e]) for i in range(len(ring)) for e in range(2)) - PRE)
    ring = ring[..., start : start + TAPS].copy()
    ring[..., -FADE:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, FADE)))
    # level: the frontal ±30° pair heard as one centred source lands at 0 dB on average (broadband)
    i30, i330 = 30 // STEP, 330 // STEP
    centre = ring[i30] + ring[i330]
    ring /= np.sqrt(np.mean(np.sum(centre**2, axis=-1)))
    return ring


def write_set(set_id, src, ring):
    out = {
        "id": set_id,
        "name": src["name"],
        "source": src["source"],
        "sampleRate": RATE,
        "stepDeg": STEP,
        "taps": TAPS,
        "ring": [{"l": b64(p[0]), "r": b64(p[1])} for p in ring],
    }
    path = OUT_DIR / f"{set_id}.json"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{path.relative_to(ROOT)}: {len(ring)} directions x {TAPS} taps, {path.stat().st_size // 1024} KB")


def features(ring):
    """Third-octave levels (dB) from 1 to 16 kHz at every direction and both ears, flattened."""
    freqs = np.fft.rfftfreq(NFFT, 1 / RATE)
    power = np.abs(np.fft.rfft(ring, NFFT, axis=-1)) ** 2
    bands = []
    for k in range(13):
        fc = 1000 * 2 ** (k / 3)
        sel = (freqs >= fc * 2 ** (-1 / 6)) & (freqs < fc * 2 ** (1 / 6))
        bands.append(10 * np.log10(np.mean(power[..., sel], axis=-1) + 1e-12))
    return np.stack(bands, axis=-1).ravel()


def farthest_points(feats, first, count):
    """`count` keys picked greedily: each the farthest (RMS dB) from its nearest already-picked one."""
    keys = list(feats)
    dist = lambda a, b: float(np.sqrt(np.mean((feats[a] - feats[b]) ** 2)))
    picked = [first]
    nearest = {k: dist(k, first) for k in keys}
    while len(picked) < count + 1 and len(picked) < len(keys):
        best = max((k for k in keys if k not in picked), key=lambda k: nearest[k])
        print(f"  pp{best}: {nearest[best]:.2f} dB from the nearest picked set")
        picked.append(best)
        for k in keys:
            nearest[k] = min(nearest[k], dist(k, best))
    return picked[1:]


def group_sets(keys, feats, seeds=GROUPS):
    """Each set -> the seed of its group, for the picker's two rounds: the first `seeds` keys (generic and
    the most different picks) head the groups, the rest join the nearest seed with room left, so the
    groups come out the same size. Round 1 compares the seeds, round 2 the winner's group."""
    dist = lambda a, b: float(np.sqrt(np.mean((feats[a] - feats[b]) ** 2)))
    heads = keys[:seeds]
    room = {h: (len(keys) - seeds) // seeds + (1 if i < (len(keys) - seeds) % seeds else 0) for i, h in enumerate(heads)}
    out = {h: h for h in heads}
    # the clearest fits first, so a borderline set doesn't take a place a near one needs
    rest = sorted(keys[seeds:], key=lambda k: min(dist(k, h) for h in heads))
    for k in rest:
        h = min((h for h in heads if room[h] > 0), key=lambda h: dist(k, h))
        out[k] = h
        room[h] -= 1
    return out


def build_candidates(generic_ring):
    rings = {1: generic_ring}
    for n in HUTUBS_SUBJECTS:
        if n == 1:
            continue
        src = hutubs_source(n)
        missing = RAW / (src["file"] + ".missing")
        if missing.exists():
            continue
        try:
            path = download(src)
        except urllib.error.HTTPError as e:
            # a few subjects only have simulated HRIRs
            print(f"  pp{n}: no measured set ({e.code})")
            missing.touch()
            continue
        rings[n] = build_ring(path)
    print(f"{len(rings)} HUTUBS subjects with a measured set")
    feats = {n: features(r) for n, r in rings.items()}
    # farthest-point sampling grabs outliers first; drop far outliers (median distance to everyone
    # else beyond Q3 + 3 IQR), which are more likely a measurement problem than an unusual ear
    keys = list(feats)
    med = np.array([np.median([np.sqrt(np.mean((feats[a] - feats[b]) ** 2)) for b in keys if b != a]) for a in keys])
    q1, q3 = np.percentile(med, [25, 75])
    for k, m in zip(keys, med):
        if m > q3 + 3 * (q3 - q1) and k != 1:
            print(f"  pp{k}: left out, {m:.2f} dB median distance (fence {q3 + 3 * (q3 - q1):.2f})")
            del feats[k]
    picks = farthest_points(feats, 1, CANDIDATES)
    groups = group_sets([1, *picks], feats)
    sid = lambda n: "generic" if n == 1 else f"hutubs-{n}"
    index = [{"id": "generic", "name": SOURCES["hutubs"]["name"], "source": SOURCES["hutubs"]["source"], "group": sid(groups[1])}]
    for n in picks:
        src = hutubs_source(n)
        write_set(f"hutubs-{n}", src, rings[n])
        index.append({"id": f"hutubs-{n}", "name": src["name"], "source": src["source"], "group": sid(groups[n])})
    for old in OUT_DIR.glob("hutubs-*.json"):
        if old.stem not in {e["id"] for e in index}:
            old.unlink()
    path = OUT_DIR / "index.json"
    path.write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    print(f"{path.relative_to(ROOT)}: {len(index)} sets")


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else "hutubs"
    src = SOURCES[key]
    ring = build_ring(download(src))
    write_set("generic", src, ring)
    if key == "hutubs":
        build_candidates(ring)


if __name__ == "__main__":
    main()
