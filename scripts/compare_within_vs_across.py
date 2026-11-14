"""Check within-video vs cross-video spectral consistency and bar-loop alignment inside 5CDhlgpjk20."""
import json
import sys
from pathlib import Path
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw" / "glenn_gane"
sys.path.insert(0, str(ROOT / "scripts"))
from compare_glenn_vs_app import load_wav_float32, welch_psd_db, interp_to_grid
from exact_aligned_glenn_comparison import find_best_offset

def main():
    sr, audio_5cd = load_wav_float32(RAW_DIR / "audio_48k.wav")
    mono_5cd = np.mean(audio_5cd, axis=1)
    segs = json.loads((RAW_DIR / "segments_5CDhlgpjk20.json").read_text(encoding="utf-8"))
    meta = json.loads((RAW_DIR / "meta_5CDhlgpjk20.json").read_text(encoding="utf-8"))

    # Check if within each track of 5CDhlgpjk20, a 'daybreak' segment and a 'supermix4' segment play the SAME repeated musical loop!
    print("=== Checking Within-Video Repeated Bar Loops inside 5CDhlgpjk20 ===")
    trim = int(0.35 * sr)
    loop_db = []
    loop_sm4 = []
    for ch in meta["chapters"]:
        if ch["start_time"] < 80:
            continue
        t0, t1 = ch["start_time"], ch["end_time"]
        db_s = [s for s in segs if s["label"] == "daybreak" and s["start"] >= t0 - 1 and s["end"] <= t1 + 1]
        sm_s = [s for s in segs if s["label"] == "supermix4" and s["start"] >= t0 - 1 and s["end"] <= t1 + 1]

        # Build concatenated SM4 audio for this chapter and search 4-second windows of Daybreak inside SM4 of the same chapter!
        if not db_s or not sm_s:
            continue
        win_len = 4 * sr
        for ds in db_s:
            a = int(ds["start"] * sr) + trim
            b = int(ds["end"] * sr) - trim
            if b - a < win_len:
                continue
            needle = mono_5cd[a : a + win_len]
            best_sc = -1.0
            best_sm_chunk = None
            for ss in sm_s:
                sa = int(ss["start"] * sr) + trim
                sb = int(ss["end"] * sr) - trim
                if sb - sa < win_len + sr:
                    continue
                off, sc = find_best_offset(needle, mono_5cd[sa:sb], sr)
                if sc > best_sc and off + win_len <= sb - sa:
                    best_sc = sc
                    best_sm_chunk = audio_5cd[sa + off : sa + off + win_len]
            if best_sc > 0.65 and best_sm_chunk is not None:
                loop_db.append(audio_5cd[a : a + win_len])
                loop_sm4.append(best_sm_chunk)
                print(f"  [{ch['title'][:22]:22}] DB {ds['start']:6.1f}s matched SM4 loop inside 5CDhlgpjk20 | Env NCC = {best_sc:.3f}")

    # Compare the 3 methods of measuring Δ_Glenn(f):
    # 1. Within 5CDhlgpjk20 Global (all 349s Daybreak vs all 361s SM4)
    # 2. Within 5CDhlgpjk20 Repeated-Loop Matched segments
    # 3. Across 5CDhlgpjk20 + LY35NjUVXVE Exact Sample-Synchronized segments (Env NCC > 0.80-0.95)
    c_within = json.loads((RAW_DIR / "comparison_results_5CDhlgpjk20.json").read_text(encoding="utf-8"))
    c_sync = json.loads((RAW_DIR / "exact_sync_results.json").read_text(encoding="utf-8"))
    grid = np.array(c_sync["grid"])
    mid_mask = (grid >= 500) & (grid <= 2000)

    if loop_db:
        ldb = np.concatenate(loop_db, axis=0)
        lsm = np.concatenate(loop_sm4, axis=0)
        f, p1 = welch_psd_db(ldb, sr, 8192)
        _, p2 = welch_psd_db(lsm, sr, 8192)
        g_loop = interp_to_grid(f, p2 - p1, grid, 1/12)
        g_loop -= np.mean(g_loop[mid_mask])
    else:
        g_loop = np.zeros_like(grid)

    w_glob = np.array(c_within["glenn_delta_global"])
    s_exact = np.array(c_sync["glenn_exact_delta"])
    r_within_vs_sync = float(np.corrcoef(w_glob[(grid >= 30) & (grid <= 12000)], s_exact[(grid >= 30) & (grid <= 12000)])[0, 1])
    print(f"\nCorrelation between Within-Video Global Delta and Cross-Video Exact-Sync Delta (30Hz-12kHz): r = {r_within_vs_sync:.4f}!")

if __name__ == "__main__":
    main()

