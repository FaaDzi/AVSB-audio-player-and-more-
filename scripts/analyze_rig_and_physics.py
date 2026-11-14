"""Analyze same-rig reviewer deltas (Daybreak vs SuperMix 4), acoustic tube-length resonance physics, and TWS behavior."""
import json
import sys
from pathlib import Path
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import frcodec
from build_iem_data import GRID, load_graph_db, SQUIG, GRAPH_DBS

RAW_DIR = ROOT / "data" / "raw" / "glenn_gane"


def main():
    res = json.loads((RAW_DIR / "exact_sync_results.json").read_text(encoding="utf-8"))
    grid = np.array(res["grid"])
    glenn = np.array(res["glenn_exact_delta"])
    mid_mask = (grid >= 500) & (grid <= 2000)
    eval_10k = (grid >= 30) & (grid <= 10000)
    eval_2k = (grid >= 30) & (grid <= 2500)

    # Check same-rig deltas across all squig_dbs + GRAPH_DBS
    same_rig_deltas = []
    folders = list(GRAPH_DBS.items())
    if SQUIG.exists():
        for p in sorted(SQUIG.iterdir()):
            if p.is_dir() and (p / "phone_book.json").exists():
                folders.append((p.name, p))

    for sname, folder in folders:
        try:
            curves = load_graph_db(folder)
        except Exception:
            continue
        db_matches = {k: v for k, v in curves.items() if "daybreak" in k.lower()}
        sm_matches = {k: v for k, v in curves.items() if "supermix 4" in k.lower() or "supermix4" in k.lower()}
        if db_matches and sm_matches:
            for dk, dv in db_matches.items():
                for sk, sv in sm_matches.items():
                    delta = (sv - dv) - np.mean((sv - dv)[mid_mask])
                    rms_10k = float(np.sqrt(np.mean((delta[eval_10k] - glenn[eval_10k]) ** 2)))
                    r_10k = float(np.corrcoef(delta[eval_10k], glenn[eval_10k])[0, 1])
                    rms_2k = float(np.sqrt(np.mean((delta[eval_2k] - glenn[eval_2k]) ** 2)))
                    r_2k = float(np.corrcoef(delta[eval_2k], glenn[eval_2k])[0, 1])
                    same_rig_deltas.append({
                        "source": sname,
                        "daybreak_name": dk,
                        "sm4_name": sk,
                        "rms_10k": rms_10k,
                        "r_10k": r_10k,
                        "rms_2k": rms_2k,
                        "r_2k": r_2k,
                        "delta": delta,
                    })

    print(f"Found {len(same_rig_deltas)} same-rig measurement pairs across {len(folders)} databases!")
    same_rig_deltas.sort(key=lambda x: x["rms_2k"])
    print("\n=== Top 12 Same-Rig Reviewer Pairs in Bass-to-Upper-Mids (30 Hz – 2.5 kHz) ===")
    for item in same_rig_deltas[:12]:
        print(f"  [{item['source']:18}] 30-2.5kHz: RMS={item['rms_2k']:.2f}dB, r={item['r_2k']:+.3f} | 30-10kHz: RMS={item['rms_10k']:.2f}dB, r={item['r_10k']:+.3f} | {item['daybreak_name']} vs {item['sm4_name']}")

    same_rig_deltas.sort(key=lambda x: x["rms_10k"])
    print("\n=== Top 12 Same-Rig Reviewer Pairs Broadband (30 Hz – 10 kHz) ===")
    for item in same_rig_deltas[:12]:
        print(f"  [{item['source']:18}] 30-10kHz: RMS={item['rms_10k']:.2f}dB, r={item['r_10k']:+.3f} | 30-2.5kHz: RMS={item['rms_2k']:.2f}dB, r={item['r_2k']:+.3f} | {item['daybreak_name']} vs {item['sm4_name']}")

    # Now check the physical mechanism of the 3.1 kHz peak and 6.3 kHz notch in Glenn Gane's coupler:
    # Let's inspect where the coupler resonances sit in the raw curves of Daybreak and SuperMix 4!
    all_deltas = np.array([x["delta"] for x in same_rig_deltas])
    med_same_rig = np.median(all_deltas, axis=0)
    p10_same_rig = np.percentile(all_deltas, 10, axis=0)
    p90_same_rig = np.percentile(all_deltas, 90, axis=0)

    rms_2k_med = float(np.sqrt(np.mean((med_same_rig[eval_2k] - glenn[eval_2k]) ** 2)))
    r_2k_med = float(np.corrcoef(med_same_rig[eval_2k], glenn[eval_2k])[0, 1])
    print(f"\n=== Multi-Reviewer Same-Rig Median vs Glenn Gane (30 Hz – 2.5 kHz) ===")
    print(f"  RMS Error = {rms_2k_med:.2f} dB | Pearson r = {r_2k_med:+.3f}!")

    # What if we model the physical silicone pinna / canal length shift above 1.5 kHz?
    # In a silicone pinna + ear simulator (as opposed to bare 711 metal tube aligned to 8 kHz),
    # the acoustic path length L is ~22% longer (shifting treble modes above 1.5 kHz by factor ~0.78 in frequency),
    # OR concha reflection adds a dip/peak dipole at 3.1 kHz / 6.3 kHz!
    # Let's test warping the frequency axis above 1.5 kHz by factor alpha = 0.72..0.85 on the treble delta:
    log_g = np.log2(grid)
    best_alpha = 1.0
    best_rms = 999.0
    best_r = 0.0
    for alpha in np.linspace(0.60, 1.00, 41):
        # Smooth blend from 1.0 below 1.2 kHz to alpha above 2.5 kHz
        w = np.clip((log_g - np.log2(1200.0)) / (np.log2(2500.0) - np.log2(1200.0)), 0.0, 1.0)
        eff_f = grid / (1.0 - w * (1.0 - alpha))
        warped = np.interp(np.log2(eff_f), log_g, med_same_rig)
        warped -= np.mean(warped[mid_mask])
        rms_w = float(np.sqrt(np.mean((warped[eval_10k] - glenn[eval_10k]) ** 2)))
        r_w = float(np.corrcoef(warped[eval_10k], glenn[eval_10k])[0, 1])
        if rms_w < best_rms:
            best_rms = rms_w
            best_r = r_w
            best_alpha = alpha

    print(f"\n=== Acoustic Canal-Length Scaling Check (30 Hz – 10 kHz) ===")
    print(f"  Optimal effective length ratio alpha = {best_alpha:.2f} (shifts 8.0 kHz -> {8000*best_alpha:.0f} Hz, 4.5 kHz -> {4500*best_alpha:.0f} Hz)")
    print(f"  With canal-length shift: RMS Error drops to {best_rms:.2f} dB | Pearson r jumps to {best_r:+.3f}!")


if __name__ == "__main__":
    main()

