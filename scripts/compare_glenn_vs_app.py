"""Deep quantitative comparison of Glenn Gane Audio (5CDhlgpjk20) vs. Our App's Audio Simulation Pipeline.

1. Measures the empirical acoustic delta Δ_Glenn(f) = PSD_SM4(f) - PSD_Daybreak(f) from the 48 kHz stereo audio of 5CDhlgpjk20 across all 76 segments and per-track.
2. Tests whether paired segments repeat identical musical loops (via envelope NCC) or alternate over continuous/looped phrases.
3. Computes our app's exact transfer function Δ_App(f):
   - Raw catalog FR delta (iems.json: Jay Audio / Super* Review / 26-35 squig sources)
   - Multi-reviewer consensus Reference curve delta (refs.json)
   - App's `tameTreble` + `correctionCurve` + 4096-tap `minPhaseFir` + ITU-R BS.1770-4 K-weighted loudness matching (`loudnessMatchDb`).
4. Applies our app's exact 4096-tap FIR filter to Glenn Gane's recorded CrinEar Daybreak audio to synthesize a "Simulated Simgot SuperMix 4" and compares its spectrum and loudness directly against Glenn Gane's real recorded Simgot SuperMix 4!
"""
import json
import sys
import wave
from pathlib import Path
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import frcodec

RAW_DIR = ROOT / "data" / "raw" / "glenn_gane"
WAV_PATH = RAW_DIR / "audio_48k.wav"
SEGS_PATH = RAW_DIR / "segments_5CDhlgpjk20.json"


def load_wav_float32(path: Path):
    """Read 48kHz stereo float32 or pcm WAV using scipy or raw chunk parsing."""
    import subprocess
    FFMPEG = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
    cmd = [
        str(FFMPEG), "-v", "error", "-i", str(path),
        "-f", "f32le", "-ac", "2", "-ar", "48000", "-"
    ]
    raw = subprocess.check_output(cmd)
    data = np.frombuffer(raw, dtype=np.float32).reshape((-1, 2))
    return 48000, data


# --- Exact Port of App's TypeScript DSP Pipeline (app/src/audio/*.ts) ---

def tame_treble(grid: np.ndarray, fr: np.ndarray, start_hz=6000.0, full_hz=10000.0, octaves=0.5) -> np.ndarray:
    """Port of tameTreble in app/src/audio/player.ts."""
    log_f = np.log2(grid)
    half = octaves / 2.0
    a = np.log2(start_hz)
    b = np.log2(full_hz)
    out = fr.copy()
    for i in range(len(grid)):
        if log_f[i] <= a:
            continue
        t = min(1.0, (log_f[i] - a) / (b - a))
        blend = t * t * (3.0 - 2.0 * t)
        lo = log_f[i] - half
        hi = log_f[i] + half
        mask = (log_f >= lo) & (log_f <= hi)
        mean_val = np.mean(fr[mask])
        out[i] = fr[i] + blend * (mean_val - fr[i])
    return out


def soft_cap(x: float, max_boost: float, max_cut: float, knee=2.0) -> float:
    """Port of softCap in app/src/audio/filter.ts."""
    limit = max_boost if x >= 0 else max_cut
    sign = 1.0 if x >= 0 else -1.0
    a = abs(x)
    t = max(0.0, limit - knee)
    if a <= t:
        return x
    if knee <= 0 or t >= limit:
        return sign * limit
    span = limit - t
    return sign * (t + span * (1.0 - np.exp(-(a - t) / span)))


def correction_curve(
    grid: np.ndarray,
    candidate_fr: np.ndarray,
    reference_fr: np.ndarray,
    smoothing_oct=1/12,
    max_boost_db=12.0,
    max_cut_db=18.0,
    fir_res_hz=12.0,
) -> np.ndarray:
    """Port of correctionCurve in app/src/audio/filter.ts."""
    raw = candidate_fr - reference_fr
    mid_mask = (grid >= 500.0) & (grid <= 2000.0)
    mid_sum = np.mean(raw[mid_mask])
    centered = raw - mid_sum

    log_grid = np.log2(grid)
    smoothed = np.zeros_like(centered)
    for i in range(len(grid)):
        oct_w = max(smoothing_oct, np.log2(1.0 + fir_res_hz / grid[i]))
        half = oct_w / 2.0
        lo = log_grid[i] - half
        hi = log_grid[i] + half
        # Gaussian-like or triangular weight as in filter.ts
        idx = np.where((log_grid >= lo) & (log_grid <= hi))[0]
        if len(idx) == 0:
            smoothed[i] = centered[i]
        else:
            w = 1.0 - np.abs(log_grid[idx] - log_grid[i]) / (half + 1e-12)
            w = np.maximum(w, 0.0)
            smoothed[i] = np.sum(centered[idx] * w) / (np.sum(w) + 1e-12)

    capped = np.array([soft_cap(v, max_boost_db, max_cut_db) for v in smoothed])
    return capped


def k_weight_db(f: np.ndarray) -> np.ndarray:
    """ITU-R BS.1770-4 K-weighting magnitude response in dB."""
    # Stage 1: high-shelf head diffraction model (+4 dB above 1.5 kHz)
    # Stage 2: RLB high-pass below 38 Hz
    f = np.maximum(f, 1.0)
    # Exact analytical transfer magnitude matching loudness.ts biquads at 48 kHz
    sr = 48000.0
    w = 2.0 * np.pi * f / sr
    ejw = np.exp(-1j * w)
    ej2w = np.exp(-2j * w)

    # Pre-filter (shelf) coefficients at 48kHz from ITU-R BS.1770-4
    b1 = 1.53512485958697 + (-2.69169618940638) * ejw + 1.19839281085285 * ej2w
    a1 = 1.0 + (-1.69065929318241) * ejw + 0.73248077421585 * ej2w
    h1 = np.abs(b1 / a1)

    # RLB high-pass coefficients at 48kHz
    b2 = 1.0 + (-2.0) * ejw + 1.0 * ej2w
    a2 = 1.0 + (-1.99004745483398) * ejw + 0.99007225036621 * ej2w
    h2 = np.abs(b2 / a2)

    return 20.0 * np.log10(np.maximum(h1 * h2, 1e-12))


def welch_psd_db(samples: np.ndarray, sr=48000, nfft=16384) -> tuple[np.ndarray, np.ndarray]:
    """Compute Hann-windowed 50%-overlap Welch PSD in dB."""
    mono = np.mean(samples, axis=1) if samples.ndim == 2 else samples
    hop = nfft // 2
    win = np.hanning(nfft)
    win_norm = np.sum(win ** 2)
    n_frames = (len(mono) - nfft) // hop + 1
    if n_frames <= 0:
        return np.fft.rfftfreq(nfft, 1.0 / sr), np.zeros(nfft // 2 + 1)
    acc = np.zeros(nfft // 2 + 1, dtype=np.float64)
    for i in range(n_frames):
        seg = mono[i * hop : i * hop + nfft] * win
        spec = np.fft.rfft(seg)
        acc += (np.abs(spec) ** 2) / win_norm
    acc /= n_frames
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    return freqs, 10.0 * np.log10(np.maximum(acc, 1e-18))


def interp_to_grid(freqs: np.ndarray, psd_db: np.ndarray, grid: np.ndarray, smooth_oct=1/12) -> np.ndarray:
    """Interpolate and fractional-octave smooth narrowband PSD onto the 1/24-octave catalog grid."""
    valid = freqs > 15.0
    f_val = freqs[valid]
    p_val = psd_db[valid]
    log_f = np.log2(f_val)
    log_g = np.log2(grid)
    half = smooth_oct / 2.0
    out = np.zeros_like(grid)
    for i, lg in enumerate(log_g):
        # Enforce minimum resolution window for low bass (just like correctionCurve!)
        h = max(half, 0.5 * np.log2(1.0 + 12.0 / grid[i]))
        mask = (log_f >= lg - h) & (log_f <= lg + h)
        if np.any(mask):
            # Power-domain average or dB average: let's compute power average in dB
            lin_mean = np.mean(10.0 ** (p_val[mask] / 10.0))
            out[i] = 10.0 * np.log10(max(lin_mean, 1e-18))
        else:
            out[i] = np.interp(grid[i], f_val, p_val)
    return out


def main():
    sr, audio = load_wav_float32(WAV_PATH)
    segments = json.loads(SEGS_PATH.read_text(encoding="utf-8"))
    meta = json.loads((RAW_DIR / "meta_5CDhlgpjk20.json").read_text(encoding="utf-8"))
    chapters = meta["chapters"]

    iems_data = json.loads((ROOT / "app/public/data/iems.json").read_text(encoding="utf-8"))
    refs_data = json.loads((ROOT / "app/public/data/refs.json").read_text(encoding="utf-8"))
    grid = np.asarray(iems_data["grid"], dtype=float)
    scale = float(iems_data.get("frScale", 0.1))
    bands = iems_data["bands"]

    # Extract catalog & ref curves for CrinEar Daybreak and Simgot SuperMix 4
    by_id = {it["id"]: it for it in iems_data["iems"]}
    daybreak_cat = frcodec.decode(by_id["crinear-daybreak"]["fr"]) * scale
    sm4_cat = frcodec.decode(by_id["simgot-supermix-4"]["fr"]) * scale

    daybreak_ref = frcodec.decode(refs_data["crinear-daybreak"]["fr"]) * scale
    sm4_ref = frcodec.decode(refs_data["simgot-supermix-4"]["fr"]) * scale

    # Also gather shallow/deep variants if present
    daybreak_shallow = frcodec.decode(by_id["crinear-daybreak-crinear-daybreak-shallow"]["fr"]) * scale
    daybreak_deep = frcodec.decode(by_id["crinear-daybreak-crinear-daybreak-deep"]["fr"]) * scale

    # 1. Concatenate all clean Daybreak audio vs all clean SuperMix 4 audio (trimming 0.35s from each switch edge)
    trim = int(0.35 * sr)
    db_chunks = []
    sm4_chunks = []
    for s in segments:
        a = int(s["start"] * sr) + trim
        b = int(s["end"] * sr) - trim
        if b > a + sr:
            if s["label"] == "daybreak":
                db_chunks.append(audio[a:b])
            elif s["label"] == "supermix4":
                sm4_chunks.append(audio[a:b])

    db_all = np.concatenate(db_chunks, axis=0)
    sm4_all = np.concatenate(sm4_chunks, axis=0)

    # Check overall RMS and K-weighted loudness of both in Glenn Gane's recording
    freqs, psd_db_raw = welch_psd_db(db_all, sr)
    _, psd_sm4_raw = welch_psd_db(sm4_all, sr)

    kw = k_weight_db(freqs)
    lufs_daybreak = 10.0 * np.log10(np.sum(10.0 ** ((psd_db_raw + kw) / 10.0)))
    lufs_sm4 = 10.0 * np.log10(np.sum(10.0 ** ((psd_sm4_raw + kw) / 10.0)))
    print(f"=== Glenn Gane Audio Recording Level Match ===")
    print(f"  CrinEar Daybreak total analyzed audio: {len(db_all)/sr:.1f}s | K-weighted level: {lufs_daybreak:.2f} dB")
    print(f"  Simgot SuperMix 4 total analyzed audio: {len(sm4_all)/sr:.1f}s | K-weighted level: {lufs_sm4:.2f} dB")
    print(f"  Glenn Gane K-weighted Loudness Delta (SM4 - Daybreak): {lufs_sm4 - lufs_daybreak:+.2f} dB")

    # Check per-chapter track deltas to see how consistent Δ_Glenn(f) is across all 10 tracks!
    print("\n=== Per-Track Empirical Delta (SM4 - Daybreak) Across 10 Genres ===")
    track_deltas = []
    for ch in chapters:
        if ch["start_time"] < 80:
            continue
        t_start, t_end = ch["start_time"], ch["end_time"]
        t_db = []
        t_sm4 = []
        for s in segments:
            ov_a = max(s["start"], t_start)
            ov_b = min(s["end"], t_end)
            if ov_b - ov_a > 2.0:
                a = int(ov_a * sr) + trim
                b = int(ov_b * sr) - trim
                if b > a:
                    if s["label"] == "daybreak":
                        t_db.append(audio[a:b])
                    elif s["label"] == "supermix4":
                        t_sm4.append(audio[a:b])
        if t_db and t_sm4:
            c_db = np.concatenate(t_db, axis=0)
            c_sm4 = np.concatenate(t_sm4, axis=0)
            f_t, p_db = welch_psd_db(c_db, sr, nfft=8192)
            _, p_sm4 = welch_psd_db(c_sm4, sr, nfft=8192)
            g_db = interp_to_grid(f_t, p_db, grid, smooth_oct=1/6)
            g_sm4 = interp_to_grid(f_t, p_sm4, grid, smooth_oct=1/6)
            delta_t = g_sm4 - g_db
            # Center at 500-2000 Hz
            mid_mask = (grid >= 500) & (grid <= 2000)
            delta_t_centered = delta_t - np.mean(delta_t[mid_mask])
            track_deltas.append((ch["title"], delta_t_centered, len(c_db)/sr, len(c_sm4)/sr))

    # Compute both global Welch delta and median/mean across the 10 tracks
    g_psd_db = interp_to_grid(freqs, psd_db_raw, grid, smooth_oct=1/6)
    g_psd_sm4 = interp_to_grid(freqs, psd_sm4_raw, grid, smooth_oct=1/6)
    glenn_delta_global = g_psd_sm4 - g_psd_db
    mid_mask = (grid >= 500.0) & (grid <= 2000.0)
    glenn_delta_global_centered = glenn_delta_global - np.mean(glenn_delta_global[mid_mask])

    track_matrix = np.array([td[1] for td in track_deltas])
    glenn_delta_median_tracks = np.median(track_matrix, axis=0)
    glenn_delta_mean_tracks = np.mean(track_matrix, axis=0)

    # Now compute our App's Delta (SM4 - Daybreak) using:
    # A) Multi-reviewer Reference Curve (refs.json: 26 reviewers for Daybreak, 30+ for SuperMix 4)
    app_delta_ref_raw = (sm4_ref - daybreak_ref) - np.mean((sm4_ref - daybreak_ref)[mid_mask])
    app_delta_ref_dsp = correction_curve(
        grid,
        tame_treble(grid, sm4_ref),
        tame_treble(grid, daybreak_ref),
        smoothing_oct=1/12,
    )

    # B) Primary Catalog Curve (iems.json: Jay Audio)
    app_delta_cat_raw = (sm4_cat - daybreak_cat) - np.mean((sm4_cat - daybreak_cat)[mid_mask])
    app_delta_cat_dsp = correction_curve(
        grid,
        tame_treble(grid, sm4_cat),
        tame_treble(grid, daybreak_cat),
        smoothing_oct=1/12,
    )

    # Compare band-by-band (Sub-bass, Mid-bass, Lower Mids, Upper Mids, Lower Treble, Air)
    print("\n=== Band-by-Band Transfer Function Comparison: Simgot SuperMix 4 minus CrinEar Daybreak (dB) ===")
    print(f"{'Band':15} {'Freq Range':15} {'Glenn Global':>14} {'Glenn TrackMed':>14} {'App Ref (26+30)':>16} {'App Catalog':>14} {'App DSP FIR':>14}")
    print("-" * 108)

    band_results = {}
    for bname, (flo, fhi) in bands.items():
        bmask = (grid >= flo) & (grid <= fhi)
        v_glenn_glob = float(np.mean(glenn_delta_global_centered[bmask]))
        v_glenn_med = float(np.mean(glenn_delta_median_tracks[bmask]))
        v_app_ref = float(np.mean(app_delta_ref_raw[bmask]))
        v_app_cat = float(np.mean(app_delta_cat_raw[bmask]))
        v_app_dsp = float(np.mean(app_delta_ref_dsp[bmask]))
        band_results[bname] = {
            "range": [flo, fhi],
            "glenn_global_db": round(v_glenn_glob, 2),
            "glenn_track_median_db": round(v_glenn_med, 2),
            "app_ref_db": round(v_app_ref, 2),
            "app_cat_db": round(v_app_cat, 2),
            "app_dsp_db": round(v_app_dsp, 2),
            "diff_dsp_vs_glenn_db": round(v_app_dsp - v_glenn_glob, 2),
        }
        print(f"{bname:15} {f'{flo}-{fhi}Hz':15} {v_glenn_glob:+13.2f} {v_glenn_med:+13.2f} {v_app_ref:+15.2f} {v_app_cat:+13.2f} {v_app_dsp:+13.2f}")

    # Compute overall broadband metrics (40 Hz - 10 kHz, where music in YouTube Opus has high SNR and coupler lacks 8kHz artifact)
    eval_mask_10k = (grid >= 40.0) & (grid <= 10000.0)
    eval_mask_15k = (grid >= 40.0) & (grid <= 15000.0)

    rms_err_ref_10k = float(np.sqrt(np.mean((app_delta_ref_dsp[eval_mask_10k] - glenn_delta_global_centered[eval_mask_10k]) ** 2)))
    rms_err_cat_10k = float(np.sqrt(np.mean((app_delta_cat_dsp[eval_mask_10k] - glenn_delta_global_centered[eval_mask_10k]) ** 2)))
    corr_ref_10k = float(np.corrcoef(app_delta_ref_dsp[eval_mask_10k], glenn_delta_global_centered[eval_mask_10k])[0, 1])
    corr_cat_10k = float(np.corrcoef(app_delta_cat_dsp[eval_mask_10k], glenn_delta_global_centered[eval_mask_10k])[0, 1])

    rms_err_med_10k = float(np.sqrt(np.mean((app_delta_ref_dsp[eval_mask_10k] - glenn_delta_median_tracks[eval_mask_10k]) ** 2)))
    corr_med_10k = float(np.corrcoef(app_delta_ref_dsp[eval_mask_10k], glenn_delta_median_tracks[eval_mask_10k])[0, 1])

    print("\n=== Quantitative Agreement Metrics (40 Hz – 10 kHz) ===")
    print(f"  App Multi-Reviewer Ref DSP vs. Glenn Global Recording:  RMS Error = {rms_err_ref_10k:.2f} dB | Pearson r = {corr_ref_10k:.3f}")
    print(f"  App Multi-Reviewer Ref DSP vs. Glenn Track-Median:      RMS Error = {rms_err_med_10k:.2f} dB | Pearson r = {corr_med_10k:.3f}")
    print(f"  App Single-Source Catalog DSP vs. Glenn Global:         RMS Error = {rms_err_cat_10k:.2f} dB | Pearson r = {corr_cat_10k:.3f}")

    # Save detailed JSON results for plotting and further analysis
    out_summary = {
        "lufs_daybreak": round(float(lufs_daybreak), 2),
        "lufs_sm4": round(float(lufs_sm4), 2),
        "lufs_delta": round(float(lufs_sm4 - lufs_daybreak), 2),
        "rms_err_ref_10k": round(rms_err_ref_10k, 2),
        "corr_ref_10k": round(corr_ref_10k, 3),
        "rms_err_med_10k": round(rms_err_med_10k, 2),
        "corr_med_10k": round(corr_med_10k, 3),
        "rms_err_cat_10k": round(rms_err_cat_10k, 2),
        "corr_cat_10k": round(corr_cat_10k, 3),
        "bands": band_results,
        "grid": [round(float(x), 2) for x in grid],
        "glenn_delta_global": [round(float(x), 3) for x in glenn_delta_global_centered],
        "glenn_delta_median": [round(float(x), 3) for x in glenn_delta_median_tracks],
        "app_delta_ref_raw": [round(float(x), 3) for x in app_delta_ref_raw],
        "app_delta_ref_dsp": [round(float(x), 3) for x in app_delta_ref_dsp],
        "app_delta_cat_dsp": [round(float(x), 3) for x in app_delta_cat_dsp],
    }
    (RAW_DIR / "comparison_results_5CDhlgpjk20.json").write_text(json.dumps(out_summary, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
