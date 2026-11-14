"""Multi-pair validation of Glenn Gane Audio (Sound demo [2]) vs. App Simulation + PIL Visual Chart Generation."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import frcodec
from compare_glenn_vs_app import (
    load_wav_float32,
    tame_treble,
    correction_curve,
    welch_psd_db,
    interp_to_grid,
)

RAW_DIR = ROOT / "data" / "raw" / "glenn_gane"
ARTIFACT_DIR = Path(r"C:\Users\Lenovo\.gemini\antigravity\brain\ae604c30-8b55-4422-afde-bda205c4dced")


def extract_slot_psd(wav_path: Path, segments: list, slot_label: str, grid: np.ndarray, sr=48000) -> np.ndarray:
    _, audio = load_wav_float32(wav_path)
    trim = int(0.35 * sr)
    chunks = []
    for s in segments:
        if s["label"] == slot_label:
            a = int(s["start"] * sr) + trim
            b = int(s["end"] * sr) - trim
            if b > a + sr:
                chunks.append(audio[a:b])
    cat = np.concatenate(chunks, axis=0)
    f, pl = welch_psd_db(cat[:, 0], sr, 16384)
    _, pr = welch_psd_db(cat[:, 1], sr, 16384)
    p_avg = 10.0 * np.log10(0.5 * (10.0 ** (pl / 10.0) + 10.0 ** (pr / 10.0)))
    return interp_to_grid(f, p_avg, grid, smooth_oct=1/12)


def draw_curve_panel(draw, box, grid, curves, y_range, title, f_max=16000.0):
    x0, y0, x1, y1 = box
    draw.rectangle([x0, y0, x1, y1], fill=(18, 22, 31), outline=(55, 65, 81), width=2)
    px0, py0, px1, py1 = x0 + 55, y0 + 38, x1 - 20, y1 - 36

    # Grid lines
    ymin, ymax = y_range
    for yv in range(int(np.ceil(ymin)), int(np.floor(ymax)) + 1, 2):
        py = py1 - (yv - ymin) / (ymax - ymin) * (py1 - py0)
        col = (95, 105, 125) if yv == 0 else (35, 42, 56)
        draw.line([(px0, py), (px1, py)], fill=col, width=2 if yv == 0 else 1)
        draw.text((x0 + 12, py - 6), f"{yv:+d}dB" if yv != 0 else " 0dB", fill=(156, 163, 175))

    lmin, lmax = np.log10(20.0), np.log10(f_max)
    for fv, flab in [(20, "20"), (50, "50"), (100, "100"), (250, "250"), (500, "500"),
                     (1000, "1k"), (2500, "2.5k"), (5000, "5k"), (10000, "10k"), (16000, "16k")]:
        if fv > f_max:
            continue
        px = px0 + (np.log10(fv) - lmin) / (lmax - lmin) * (px1 - px0)
        draw.line([(px, py0), (px, py1)], fill=(35, 42, 56), width=1)
        draw.text((px - 10, py1 + 8), flab, fill=(156, 163, 175))

    draw.text((x0 + 16, y0 + 10), title, fill=(243, 244, 246))

    # Plot curves
    valid = (grid >= 20.0) & (grid <= f_max)
    g_sub = grid[valid]
    for label, vals, color, width in curves:
        v_sub = np.clip(vals[valid], ymin, ymax)
        pts = []
        for f_val, y_val in zip(g_sub, v_sub):
            px = px0 + (np.log10(f_val) - lmin) / (lmax - lmin) * (px1 - px0)
            py = py1 - (y_val - ymin) / (ymax - ymin) * (py1 - py0)
            pts.append((px, py))
        if len(pts) > 1:
            draw.line(pts, fill=color, width=width)

    # Legend
    lx, ly = px0 + 10, py0 + 8
    for label, _, color, _ in curves:
        draw.rectangle([lx, ly + 4, lx + 16, ly + 8], fill=color)
        draw.text((lx + 22, ly), label, fill=(229, 231, 235))
        ly += 18


def main():
    w_5cd = RAW_DIR / "audio_48k.wav"          # Slot1: CrinEar Daybreak, Slot2: Simgot SuperMix 4
    w_03v = RAW_DIR / "03VVacBowhI_48k.wav"    # Slot1: CrinEar Daybreak, Slot2: Letshuoer Galileo
    w_leI = RAW_DIR / "LeI_E5McA3c_48k.wav"    # Slot1: InAwaken Dawn-Ms, Slot2: Truthear Hexa
    w_t6l = RAW_DIR / "t6LcBJMJIb4_48k.wav"    # Slot1: Dunu DN142,       Slot2: Simgot SuperMix 4

    segments = json.loads((RAW_DIR / "segments_5CDhlgpjk20.json").read_text(encoding="utf-8"))
    iems_data = json.loads((ROOT / "app/public/data/iems.json").read_text(encoding="utf-8"))
    refs_data = json.loads((ROOT / "app/public/data/refs.json").read_text(encoding="utf-8"))
    grid = np.asarray(iems_data["grid"], dtype=float)
    scale = float(iems_data.get("frScale", 0.1))
    bands = iems_data["bands"]
    by_id = {it["id"]: it for it in iems_data["iems"]}

    psd_daybreak_5cd = extract_slot_psd(w_5cd, segments, "daybreak", grid)
    psd_daybreak_03v = extract_slot_psd(w_03v, segments, "daybreak", grid)
    psd_dunu142_t6l  = extract_slot_psd(w_t6l, segments, "daybreak", grid)

    psd_sm4_5cd      = extract_slot_psd(w_5cd, segments, "supermix4", grid)
    psd_sm4_t6l      = extract_slot_psd(w_t6l, segments, "supermix4", grid)
    psd_galileo_03v  = extract_slot_psd(w_03v, segments, "supermix4", grid)
    psd_hexa_leI     = extract_slot_psd(w_leI, segments, "supermix4", grid)

    diff_db_repeat = psd_daybreak_5cd - psd_daybreak_03v
    diff_sm4_repeat = psd_sm4_5cd - psd_sm4_t6l

    mask_10k = (grid >= 30) & (grid <= 10000)
    print("=== Glenn Gane Audio Master Recording Repeatability Across Videos ===")
    print(f"  CrinEar Daybreak (5CDhlgpjk20 vs 03VVacBowhI, 349s Slot 1): RMS Diff = {np.sqrt(np.mean(diff_db_repeat[mask_10k]**2)):.3f} dB!")
    print(f"  Simgot SuperMix 4 (5CDhlgpjk20 vs t6LcBJMJIb4, 362s Slot 2): RMS Diff = {np.sqrt(np.mean(diff_sm4_repeat[mask_10k]**2)):.3f} dB!")

    def get_app_curve(iem_id: str) -> np.ndarray:
        if iem_id in refs_data:
            return frcodec.decode(refs_data[iem_id]["fr"]) * scale
        return frcodec.decode(by_id[iem_id]["fr"]) * scale

    hexa_ids = [k for k in by_id if "hexa" in k and "symphony" not in k]
    hexa_id = "truthear-hexa" if "truthear-hexa" in by_id else hexa_ids[0]
    galileo_id = "letshuoer-x-gizaudio-galileo"
    dunu_id = "dunu-142"

    mid_mask = (grid >= 500) & (grid <= 2000)
    eval_core = (grid >= 30) & (grid <= 2500)
    eval_10k = (grid >= 30) & (grid <= 10000)

    sync_res = json.loads((RAW_DIR / "exact_sync_results.json").read_text(encoding="utf-8"))
    glenn_db_sm4 = np.array(sync_res["glenn_exact_delta"])
    app_db_sm4_ref = np.array(sync_res["app_ref_dsp"])
    app_db_sm4_cat = np.array(sync_res["app_cat_dsp"])

    fr_db_shallow = frcodec.decode(by_id["crinear-daybreak-crinear-daybreak-shallow-fit"]["fr"]) * scale
    fr_sm4_cat = frcodec.decode(by_id["simgot-supermix-4"]["fr"]) * scale
    app_db_sm4_shallow = correction_curve(grid, tame_treble(grid, fr_sm4_cat), tame_treble(grid, fr_db_shallow))

    glenn_sm4_hexa = (psd_sm4_5cd - psd_hexa_leI) - np.mean((psd_sm4_5cd - psd_hexa_leI)[mid_mask])
    app_sm4_hexa = correction_curve(grid, tame_treble(grid, get_app_curve("simgot-supermix-4")), tame_treble(grid, get_app_curve(hexa_id)))

    glenn_sm4_galileo = (psd_sm4_5cd - psd_galileo_03v) - np.mean((psd_sm4_5cd - psd_galileo_03v)[mid_mask])
    app_sm4_galileo = correction_curve(grid, tame_treble(grid, get_app_curve("simgot-supermix-4")), tame_treble(grid, get_app_curve(galileo_id)))

    glenn_db_dunu = (psd_daybreak_5cd - psd_dunu142_t6l) - np.mean((psd_daybreak_5cd - psd_dunu142_t6l)[mid_mask])
    app_db_dunu = correction_curve(grid, tame_treble(grid, get_app_curve("crinear-daybreak")), tame_treble(grid, get_app_curve(dunu_id)))

    pairs = [
        ("Simgot SuperMix 4 vs CrinEar Daybreak (5CDhlgpjk20)", glenn_db_sm4, app_db_sm4_ref, app_db_sm4_shallow),
        ("Simgot SuperMix 4 vs Truthear Hexa (Slot 2 Bit-Sync)", glenn_sm4_hexa, app_sm4_hexa, app_sm4_hexa),
        ("Simgot SuperMix 4 vs Letshuoer Galileo (Slot 2 Bit-Sync)", glenn_sm4_galileo, app_sm4_galileo, app_sm4_galileo),
        ("CrinEar Daybreak vs Dunu DN142 (Slot 1 Bit-Sync)", glenn_db_dunu, app_db_dunu, app_db_dunu),
    ]

    print("\n=== MULTI-PAIR BENCHMARK SUMMARY: Glenn Gane Audio vs. App DSP Simulation ===")
    summary_rows = []
    for title, g_delta, a_dsp, a_alt in pairs:
        rms_core = float(np.sqrt(np.mean((a_dsp[eval_core] - g_delta[eval_core]) ** 2)))
        r_core = float(np.corrcoef(a_dsp[eval_core], g_delta[eval_core])[0, 1])
        rms_10k = float(np.sqrt(np.mean((a_dsp[eval_10k] - g_delta[eval_10k]) ** 2)))
        r_10k = float(np.corrcoef(a_dsp[eval_10k], g_delta[eval_10k])[0, 1])
        print(f"\n  * {title}")
        print(f"    Bass-to-Upper-Mids (30 Hz – 2.5 kHz): RMS Error = {rms_core:.2f} dB | Pearson r = {r_core:+.3f}")
        print(f"    Broadband (30 Hz – 10 kHz):           RMS Error = {rms_10k:.2f} dB | Pearson r = {r_10k:+.3f}")
        b_dict = {}
        for bname, (flo, fhi) in bands.items():
            bm = (grid >= flo) & (grid <= fhi)
            gv = float(np.mean(g_delta[bm]))
            av = float(np.mean(a_dsp[bm]))
            b_dict[bname] = (round(gv, 2), round(av, 2))
            print(f"      {bname:12}: Glenn = {gv:+6.2f} dB | App DSP = {av:+6.2f} dB | Diff = {av - gv:+6.2f} dB")
        summary_rows.append({
            "title": title,
            "rms_core": round(rms_core, 2),
            "r_core": round(r_core, 3),
            "rms_10k": round(rms_10k, 2),
            "r_10k": round(r_10k, 3),
            "bands": b_dict,
        })

    # Render clean 1600x1000 dashboard image using PIL
    W, H = 1600, 1000
    img = Image.new("RGB", (W, H), (11, 15, 23))
    draw = ImageDraw.Draw(img)
    draw.text((30, 14), "Glenn Gane Audio (5CDhlgpjk20 & Sound demo [2]) vs. App Minimum-Phase FIR Simulation", fill=(255, 255, 255))

    db_ref = get_app_curve("crinear-daybreak")
    sm_ref = get_app_curve("simgot-supermix-4")
    db_norm = db_ref - np.mean(db_ref[mid_mask])
    sm_norm = sm_ref - np.mean(sm_ref[mid_mask])

    draw_curve_panel(
        draw, (25, 48, 785, 495), grid,
        [
            ("CrinEar Daybreak (App Ref: 26 rigs, Tilted JM-1)", db_norm, (192, 132, 252), 3),
            ("Simgot SuperMix 4 (App Ref: 30+ rigs, Harman 2019)", sm_norm, (52, 211, 153), 3),
        ],
        (-8, 14), "1. App Multi-Reviewer Reference Curves (Centered 0.5-2 kHz)"
    )

    draw_curve_panel(
        draw, (815, 48, 1575, 495), grid,
        [
            ("Glenn Gane 5CDhlgpjk20 Empirical Delta (182.5s Sync PSD)", glenn_db_sm4, (251, 191, 36), 3),
            ("App FIR Correction (Multi-Reviewer Consensus Ref)", app_db_sm4_ref, (56, 189, 248), 3),
            ("App FIR Correction (Primary Catalog: Jay Audio)", app_db_sm4_cat, (129, 140, 248), 2),
            ("App FIR Correction (Shallow-Fit Silicone Pinna Match)", app_db_sm4_shallow, (244, 114, 182), 2),
        ],
        (-6, 6), "2. Transfer Delta: Simgot SuperMix 4 minus CrinEar Daybreak (dB)"
    )

    draw_curve_panel(
        draw, (25, 520, 785, 975), grid,
        [
            ("Glenn Gane: SuperMix 4 - Truthear Hexa (362s Bit-Sync)", glenn_sm4_hexa, (251, 191, 36), 3),
            ("App DSP FIR: SuperMix 4 - Truthear Hexa", app_sm4_hexa, (56, 189, 248), 3),
        ],
        (-8, 10), "3. Bit-Synchronized Cross-Validation: Simgot SuperMix 4 minus Truthear Hexa"
    )

    draw_curve_panel(
        draw, (815, 520, 1575, 975), grid,
        [
            ("Glenn Gane: SuperMix 4 - Letshuoer Galileo (362s Bit-Sync)", glenn_sm4_galileo, (52, 211, 153), 3),
            ("App DSP FIR: SuperMix 4 - Letshuoer Galileo", app_sm4_galileo, (192, 132, 252), 3),
            ("Glenn Gane: Daybreak - Dunu DN142 (349s Bit-Sync)", glenn_db_dunu, (251, 146, 60), 2),
            ("App DSP FIR: Daybreak - Dunu DN142", app_db_dunu, (244, 114, 182), 2),
        ],
        (-8, 10), "4. Bit-Synchronized Cross-Validation: Galileo & Dunu DN142 Pairs"
    )

    chart_path = ARTIFACT_DIR / "glenn_gane_5CDhlgpjk20_dsp_comparison.png"
    img.save(chart_path)
    print(f"\nSaved visual comparison chart to: {chart_path}")


if __name__ == "__main__":
    main()
