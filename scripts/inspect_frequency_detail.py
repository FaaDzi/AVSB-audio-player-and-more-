"""Inspect fine frequency-by-frequency structure of Δ_Glenn(f) vs Δ_App(f) and test all reviewer/fit/impedance variants."""
import json
import sys
from pathlib import Path
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import frcodec

RAW_DIR = ROOT / "data" / "raw" / "glenn_gane"

def main():
    res = json.loads((RAW_DIR / "exact_sync_results.json").read_text(encoding="utf-8"))
    grid = np.array(res["grid"])
    glenn = np.array(res["glenn_exact_delta"])
    glenn_med = np.array(res["glenn_track_median"])
    app_ref = np.array(res["app_ref_dsp"])
    app_cat = np.array(res["app_cat_dsp"])

    # Print 1/3-octave table from 25 Hz to 16 kHz
    key_freqs = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
                 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000]
    print("=== 1/3-Octave Frequency Table: Simgot SuperMix 4 minus CrinEar Daybreak (dB) ===")
    print(f"{'Freq (Hz)':>10} | {'Glenn Sync':>11} | {'Glenn Med':>11} | {'App Ref DSP':>11} | {'App Cat DSP':>11} | {'Diff (Ref-Glenn)':>16}")
    print("-" * 84)
    for kf in key_freqs:
        idx = int(np.argmin(np.abs(grid - kf)))
        f_actual = grid[idx]
        print(f"{f_actual:10.1f} | {glenn[idx]:+11.2f} | {glenn_med[idx]:+11.2f} | {app_ref[idx]:+11.2f} | {app_cat[idx]:+11.2f} | {app_ref[idx] - glenn[idx]:+16.2f}")

    # Also check all variants of Daybreak and SuperMix 4 in iems.json!
    iems_data = json.loads((ROOT / "app/public/data/iems.json").read_text(encoding="utf-8"))
    scale = float(iems_data.get("frScale", 0.1))
    daybreaks = [it for it in iems_data["iems"] if "daybreak" in it["id"]]
    sm4s = [it for it in iems_data["iems"] if "supermix-4" in it["id"] or "supermix4" in it["id"]]

    print(f"\nComparing {len(daybreaks)} Daybreak entries x {len(sm4s)} SuperMix 4 entries against Glenn Gane's recording:")
    mid_mask = (grid >= 500) & (grid <= 2000)
    eval_mask = (grid >= 30) & (grid <= 10000)

    combos = []
    for d in daybreaks:
        fr_d = frcodec.decode(d["fr"]) * scale
        for s in sm4s:
            fr_s = frcodec.decode(s["fr"]) * scale
            delta = (fr_s - fr_d) - np.mean((fr_s - fr_d)[mid_mask])
            rms = float(np.sqrt(np.mean((delta[eval_mask] - glenn[eval_mask]) ** 2)))
            r = float(np.corrcoef(delta[eval_mask], glenn[eval_mask])[0, 1])
            combos.append((rms, r, d["id"], d["source"], s["id"], s["source"], delta))

    combos.sort(key=lambda x: x[0])
    print("\nTop 10 Closest Variant Pairs (30 Hz – 10 kHz):")
    for rms, r, did, dsrc, sid, ssrc, _ in combos[:10]:
        print(f"  RMS = {rms:.2f} dB | r = {r:+.3f} | {did} ({dsrc}) vs {sid} ({ssrc})")

if __name__ == "__main__":
    main()

