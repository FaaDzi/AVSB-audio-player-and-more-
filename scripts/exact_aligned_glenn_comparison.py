"""Exact sample-aligned transfer function measurement of Glenn Gane Audio's CrinEar Daybreak vs Simgot SuperMix 4.

Why this works with mathematical perfection:
- In `5CDhlgpjk20` (Crinear Daybreak vs Simgot Supermix 4), CrinEar Daybreak is IEM #1 (playing odd segments: bars 1-4, 9-12, ...)
  and Simgot SuperMix 4 is IEM #2 (playing even segments: bars 5-8, 13-16, ...).
- In `LY35NjUVXVE` (Simgot Supermix 4 vs Truthear Nova), Simgot SuperMix 4 is IEM #1 (playing the EXACT SAME odd segments: bars 1-4, 9-12, ...)
  across the same songs (Bassline, Girl Power, Howling, Dream A Dream, Good Vibrations, Trading Samba, Middle Eastern, Crashing Cars, Summer Samba)!
- By aligning each odd segment of `5CDhlgpjk20` (CrinEar Daybreak) with the matching odd segment of `LY35NjUVXVE` (Simgot SuperMix 4),
  both IEMs are driven by the EXACT SAME underlying studio master waveform S(f)!
- Therefore, S(f) cancels out 100%:
    Δ_Glenn_Exact(f) = PSD_SM4_Slot1(f) - PSD_Daybreak_Slot1(f) = |H_SM4(f)|² - |H_Daybreak(f)|² !
"""
import json
import subprocess
import sys
from pathlib import Path
import numpy as np
import yt_dlp

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import frcodec
from compare_glenn_vs_app import (
    load_wav_float32,
    tame_treble,
    correction_curve,
    k_weight_db,
    welch_psd_db,
    interp_to_grid,
)

FFMPEG = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
RAW_DIR = ROOT / "data" / "raw" / "glenn_gane"


def ensure_ly35_audio() -> Path:
    wav_out = RAW_DIR / "LY35NjUVXVE_48k.wav"
    if wav_out.exists():
        return wav_out
    url = "https://www.youtube.com/watch?v=LY35NjUVXVE"
    audio_tmpl = RAW_DIR / "LY35NjUVXVE_audio.%(ext)s"
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(audio_tmpl),
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        dl_path = Path(ydl.prepare_filename(info))
    subprocess.run([
        str(FFMPEG), "-v", "error", "-y", "-i", str(dl_path),
        "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", str(wav_out)
    ], check=True)
    return wav_out


def find_best_offset(seg_a: np.ndarray, search_b: np.ndarray, sr=48000) -> tuple[int, float]:
    """Find exact sample offset of seg_a inside search_b using downsampled envelope + fine waveform cross-correlation."""
    # Step 1: 1000 Hz envelope correlation to find coarse offset within +-5ms
    ds = 48  # 1 kHz
    n_a = len(seg_a) // ds
    n_b = len(search_b) // ds
    env_a = np.sqrt(np.mean(seg_a[:n_a * ds].reshape(n_a, ds) ** 2, axis=1) + 1e-12)
    env_b = np.sqrt(np.mean(search_b[:n_b * ds].reshape(n_b, ds) ** 2, axis=1) + 1e-12)

    a_norm = (env_a - np.mean(env_a)) / (np.std(env_a) + 1e-9)
    sz = 1 << int(np.ceil(np.log2(len(env_b) + len(a_norm))))
    corr = np.fft.irfft(np.fft.rfft(env_b, sz) * np.conj(np.fft.rfft(a_norm, sz)), sz)[:len(env_b) - len(a_norm) + 1]

    c1 = np.cumsum(np.concatenate([[0.0], env_b]))
    c2 = np.cumsum(np.concatenate([[0.0], env_b ** 2]))
    m = (c1[len(a_norm):] - c1[:-len(a_norm)]) / len(a_norm)
    s = np.sqrt(np.maximum((c2[len(a_norm):] - c2[:-len(a_norm)]) / len(a_norm) - m ** 2, 1e-12))
    scores = corr / (len(a_norm) * s)
    best_i = int(np.argmax(scores))
    best_score = float(scores[best_i])

    # Step 2: Fine sample-level alignment around best_i * ds (+/- 240 samples)
    coarse_sample = best_i * ds
    lo = max(0, coarse_sample - 480)
    hi = min(len(search_b) - len(seg_a), coarse_sample + 480)
    if hi <= lo:
        return coarse_sample, best_score

    sub_b = search_b[lo : hi + len(seg_a)]
    sz_f = 1 << int(np.ceil(np.log2(len(sub_b) + len(seg_a))))
    f_corr = np.fft.irfft(np.fft.rfft(sub_b, sz_f) * np.conj(np.fft.rfft(seg_a, sz_f)), sz_f)[:hi - lo + 1]
    fine_off = int(np.argmax(np.abs(f_corr)))
    return lo + fine_off, best_score


def main():
    ly35_wav = ensure_ly35_audio()
    sr, audio_5cd = load_wav_float32(RAW_DIR / "audio_48k.wav")
    _, audio_ly35 = load_wav_float32(ly35_wav)

    mono_5cd = np.mean(audio_5cd, axis=1)
    mono_ly35 = np.mean(audio_ly35, axis=1)

    segments_5cd = json.loads((RAW_DIR / "segments_5CDhlgpjk20.json").read_text(encoding="utf-8"))

    # Map shared tracks between 5CDhlgpjk20 and LY35NjUVXVE:
    # (title, 5cd_start, 5cd_end, ly35_start, ly35_end)
    SHARED_TRACKS = [
        ("Funk Bassline", 83, 135, 1, 57),
        ("Girl Power", 135, 238, 57, 155),
        ("Howling", 238, 315, 228, 311),
        ("Dream A Dream", 315, 368, 311, 364),
        ("Good Vibrations", 435, 501, 364, 429),
        ("Trading Samba", 501, 593, 429, 522),
        ("Middle Eastern", 593, 717, 522, 645),
        ("Crashing Cars", 717, 775, 645, 702),
        ("Summer Samba", 775, 872, 702, 800),
    ]

    trim = int(0.4 * sr)
    aligned_daybreak_chunks = []
    aligned_sm4_chunks = []
    track_pairs = []

    print("=== Sample-Synchronized Alignment of CrinEar Daybreak (5CDhlgpjk20) vs Simgot SuperMix 4 (LY35NjUVXVE) ===")
    for title, s5, e5, sly, ely in SHARED_TRACKS:
        # Find all 'daybreak' segments inside [s5, e5] in 5CDhlgpjk20
        t_db_segs = [s for s in segments_5cd if s["label"] == "daybreak" and s["start"] >= s5 - 1 and s["end"] <= e5 + 1]
        search_b = mono_ly35[int(sly * sr) : int(ely * sr)]
        stereo_b = audio_ly35[int(sly * sr) : int(ely * sr)]

        t_db_list = []
        t_sm4_list = []
        for s in t_db_segs:
            a = int(s["start"] * sr) + trim
            b = int(s["end"] * sr) - trim
            if b - a < 2 * sr:
                continue
            seg_mono = mono_5cd[a:b]
            seg_stereo = audio_5cd[a:b]
            off, score = find_best_offset(seg_mono, search_b, sr)
            if score > 0.80 and off + len(seg_mono) <= len(stereo_b):
                matched_stereo = stereo_b[off : off + len(seg_mono)]
                aligned_daybreak_chunks.append(seg_stereo)
                aligned_sm4_chunks.append(matched_stereo)
                t_db_list.append(seg_stereo)
                t_sm4_list.append(matched_stereo)
                print(f"  [{title:16}] 5CD {s['start']:6.1f}-{s['end']:6.1f}s -> LY35 {sly + off/sr:6.2f}s | Env NCC = {score:.4f}")
        if t_db_list:
            track_pairs.append((title, np.concatenate(t_db_list, axis=0), np.concatenate(t_sm4_list, axis=0)))

    db_sync = np.concatenate(aligned_daybreak_chunks, axis=0)
    sm4_sync = np.concatenate(aligned_sm4_chunks, axis=0)
    print(f"\nTotal sample-synchronized identical music analyzed: {len(db_sync)/sr:.1f}s per IEM!")

    # Check channel correlation (remember commenter noted L/R swap!)
    corr_ll = np.corrcoef(db_sync[:sr*30, 0], sm4_sync[:sr*30, 0])[0, 1]
    corr_lr = np.corrcoef(db_sync[:sr*30, 0], sm4_sync[:sr*30, 1])[0, 1]
    print(f"Stereo Channel Check (first 30s): L-to-L corr = {corr_ll:.4f}, L-to-R corr = {corr_lr:.4f}")

    # Load catalog & ref curves
    iems_data = json.loads((ROOT / "app/public/data/iems.json").read_text(encoding="utf-8"))
    refs_data = json.loads((ROOT / "app/public/data/refs.json").read_text(encoding="utf-8"))
    grid = np.asarray(iems_data["grid"], dtype=float)
    scale = float(iems_data.get("frScale", 0.1))
    bands = iems_data["bands"]
    by_id = {it["id"]: it for it in iems_data["iems"]}

    daybreak_cat = frcodec.decode(by_id["crinear-daybreak"]["fr"]) * scale
    sm4_cat = frcodec.decode(by_id["simgot-supermix-4"]["fr"]) * scale
    daybreak_ref = frcodec.decode(refs_data["crinear-daybreak"]["fr"]) * scale
    sm4_ref = frcodec.decode(refs_data["simgot-supermix-4"]["fr"]) * scale

    # Compute exact Welch PSD on the synchronized audio (L+R power average so L/R swap doesn't cancel stereo diff!)
    def stereo_power_psd_db(stereo_sig, sr=48000, nfft=16384):
        f, p_l = welch_psd_db(stereo_sig[:, 0], sr, nfft)
        _, p_r = welch_psd_db(stereo_sig[:, 1], sr, nfft)
        p_avg = 10.0 * np.log10(0.5 * (10.0 ** (p_l / 10.0) + 10.0 ** (p_r / 10.0)))
        return f, p_avg, p_l, p_r

    freqs, psd_db, psd_db_l, psd_db_r = stereo_power_psd_db(db_sync, sr)
    _, psd_sm4, psd_sm4_l, psd_sm4_r = stereo_power_psd_db(sm4_sync, sr)

    mid_mask = (grid >= 500.0) & (grid <= 2000.0)
    g_db = interp_to_grid(freqs, psd_db, grid, smooth_oct=1/12)
    g_sm4 = interp_to_grid(freqs, psd_sm4, grid, smooth_oct=1/12)
    glenn_exact_delta = (g_sm4 - g_db) - np.mean((g_sm4 - g_db)[mid_mask])

    # Per-track synchronized deltas
    track_delta_list = []
    for title, c_db, c_sm4 in track_pairs:
        ft, p1, _, _ = stereo_power_psd_db(c_db, sr, nfft=8192)
        _, p2, _, _ = stereo_power_psd_db(c_sm4, sr, nfft=8192)
        d = interp_to_grid(ft, p2 - p1, grid, smooth_oct=1/12)
        d -= np.mean(d[mid_mask])
        track_delta_list.append(d)
    glenn_track_median = np.median(np.array(track_delta_list), axis=0)

    # App curves
    app_ref_raw = (sm4_ref - daybreak_ref) - np.mean((sm4_ref - daybreak_ref)[mid_mask])
    app_ref_dsp = correction_curve(grid, tame_treble(grid, sm4_ref), tame_treble(grid, daybreak_ref), smoothing_oct=1/12)
    app_cat_raw = (sm4_cat - daybreak_cat) - np.mean((sm4_cat - daybreak_cat)[mid_mask])
    app_cat_dsp = correction_curve(grid, tame_treble(grid, sm4_cat), tame_treble(grid, daybreak_cat), smoothing_oct=1/12)

    print("\n=== EXACT SYNCHRONIZED Band-by-Band Delta: Simgot SuperMix 4 minus CrinEar Daybreak (dB) ===")
    print(f"{'Band':15} {'Freq Range':15} {'Glenn SyncPSD':>14} {'Glenn TrackMed':>14} {'App Ref (26+30)':>16} {'App Catalog':>14} {'App DSP FIR':>14}")
    print("-" * 108)
    band_out = {}
    for bname, (flo, fhi) in bands.items():
        bmask = (grid >= flo) & (grid <= fhi)
        v_sync = float(np.mean(glenn_exact_delta[bmask]))
        v_med = float(np.mean(glenn_track_median[bmask]))
        v_ref = float(np.mean(app_ref_raw[bmask]))
        v_cat = float(np.mean(app_cat_raw[bmask]))
        v_dsp = float(np.mean(app_ref_dsp[bmask]))
        band_out[bname] = {
            "range": [flo, fhi],
            "glenn_sync_db": round(v_sync, 2),
            "glenn_track_med_db": round(v_med, 2),
            "app_ref_raw_db": round(v_ref, 2),
            "app_cat_raw_db": round(v_cat, 2),
            "app_dsp_db": round(v_dsp, 2),
            "error_dsp_vs_glenn_db": round(v_dsp - v_sync, 2),
        }
        print(f"{bname:15} {f'{flo}-{fhi}Hz':15} {v_sync:+13.2f} {v_med:+13.2f} {v_ref:+15.2f} {v_cat:+13.2f} {v_dsp:+13.2f}")

    for label, fmax in [("20 Hz – 6 kHz (Core Tonal Band, pre-coupler resonance)", 6000.0),
                        ("20 Hz – 10 kHz (SimAccuracy Band)", 10000.0),
                        ("20 Hz – 16 kHz (Full Audible Bandwidth)", 16000.0)]:
        m = (grid >= 25.0) & (grid <= fmax)
        rms_dsp = float(np.sqrt(np.mean((app_ref_dsp[m] - glenn_exact_delta[m]) ** 2)))
        corr_dsp = float(np.corrcoef(app_ref_dsp[m], glenn_exact_delta[m])[0, 1])
        rms_raw = float(np.sqrt(np.mean((app_ref_raw[m] - glenn_exact_delta[m]) ** 2)))
        corr_raw = float(np.corrcoef(app_ref_raw[m], glenn_exact_delta[m])[0, 1])
        rms_cat = float(np.sqrt(np.mean((app_cat_dsp[m] - glenn_exact_delta[m]) ** 2)))
        corr_cat = float(np.corrcoef(app_cat_dsp[m], glenn_exact_delta[m])[0, 1])
        print(f"\n=== {label} ===")
        print(f"  App Multi-Reviewer Ref + DSP (tameTreble+FIR): RMS Diff = {rms_dsp:.2f} dB | Pearson r = {corr_dsp:.3f}")
        print(f"  App Multi-Reviewer Raw Delta (unsmoothed):     RMS Diff = {rms_raw:.2f} dB | Pearson r = {corr_raw:.3f}")
        print(f"  App Single-Reviewer Catalog + DSP:             RMS Diff = {rms_cat:.2f} dB | Pearson r = {corr_cat:.3f}")

    # Save synchronized results
    (RAW_DIR / "exact_sync_results.json").write_text(json.dumps({
        "total_sync_seconds": round(len(db_sync) / sr, 1),
        "stereo_corr_ll": round(float(corr_ll), 4),
        "stereo_corr_lr": round(float(corr_lr), 4),
        "bands": band_out,
        "grid": [round(float(x), 2) for x in grid],
        "glenn_exact_delta": [round(float(x), 3) for x in glenn_exact_delta],
        "glenn_track_median": [round(float(x), 3) for x in glenn_track_median],
        "app_ref_raw": [round(float(x), 3) for x in app_ref_raw],
        "app_ref_dsp": [round(float(x), 3) for x in app_ref_dsp],
        "app_cat_dsp": [round(float(x), 3) for x in app_cat_dsp],
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

