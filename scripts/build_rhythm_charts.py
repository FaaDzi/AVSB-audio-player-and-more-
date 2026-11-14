"""Offline AutoRhythm & NoteSight Multi-Band Spectral Flux Charter for all 300 Opus tracks.

Analyzes all 300 real .opus files in songs/originals/ using 4-band spectral flux,
RMS sustain envelope tracking, spectral centroid pitch-sweep slope, and NoteSight
beat-grid locking to generate app/public/data/rhythm_charts_300.json.

Usage:
    python scripts/build_rhythm_charts.py [--workers 12]
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
from mutagen.oggopus import OggOpus

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "songs" / "manifest.json"
UNIFIED_STAGES_PATH = ROOT / "docs" / "groove_coaster_300_unified_stages.json"
ORIGINALS_DIR = ROOT / "songs" / "originals"
OUTPUT_JSON_PATH = ROOT / "app" / "public" / "data" / "rhythm_charts_300.json"

FFMPEG_BIN = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
if not FFMPEG_BIN.exists():
    found_ff = shutil.which("ffmpeg")
    if found_ff:
        FFMPEG_BIN = Path(found_ff)

SAMPLE_RATE = 22050
FFT_SIZE = 1024
HOP_SIZE = 512
FRAME_RATE = SAMPLE_RATE / HOP_SIZE  # ~43.0664 fps
BIN_HZ = SAMPLE_RATE / FFT_SIZE      # ~21.5332 Hz

# 14 Audited Special Treatment Rhythm Game Cuts (in seconds)
SPECIAL_TREATMENT_CUTS: dict[int, tuple[float, float]] = {
    1: (0.0, 135.0),
    41: (135.0, 275.0),
    144: (0.0, 140.0),
    157: (205.0, 345.0),
    199: (15.0, 150.0),
    200: (25.0, 158.0),
    220: (102.0, 237.0),
    223: (13.0, 148.0),
    224: (140.0, 280.0),
    239: (10.0, 145.0),
    245: (34.0, 166.0),
    285: (15.0, 150.0),
    292: (100.0, 235.0),
    297: (15.0, 150.0),
}

# Exact known BPM overrides for flagship tracks
KNOWN_BPMS: dict[int, int] = {
    1: 108,
    144: 222,
    200: 154,
    239: 158,
    292: 136,
    297: 162,
}

TYPE_MAP: dict[int, str] = {
    0: "tap",
    1: "hold",
    2: "dual_hold",
    3: "hold_slide",
    4: "beat_strike",
    5: "dual_tap",
    6: "spam_rush",
    7: "scratch",
    8: "dual_scratch",
    9: "invisible",
    10: "adlib",
}

SLIDE_DIRECTIONS_16: list[str] = [
    "RIGHT",
    "UP_RIGHT_EAST",
    "UP_RIGHT",
    "UP_RIGHT_NORTH",
    "UP",
    "UP_LEFT_NORTH",
    "UP_LEFT",
    "UP_LEFT_WEST",
    "LEFT",
    "DOWN_LEFT_WEST",
    "DOWN_LEFT",
    "DOWN_LEFT_SOUTH",
    "DOWN",
    "DOWN_RIGHT_SOUTH",
    "DOWN_RIGHT",
    "DOWN_RIGHT_EAST",
]

HANNING_WINDOW = np.hanning(FFT_SIZE).astype(np.float32)
RFFT_FREQS = np.fft.rfftfreq(FFT_SIZE, d=1.0 / SAMPLE_RATE).astype(np.float32)

# Band bin indices:
# sub_bass: 20 - 160 Hz
# low_mid: 160 - 800 Hz
# high_mid: 800 - 3200 Hz
# treble: 3200 - 10000 Hz
B_SUB_START = max(1, int(np.floor(20.0 / BIN_HZ)))
B_SUB_END = max(B_SUB_START + 1, int(np.ceil(160.0 / BIN_HZ)))
B_LOWMID_END = max(B_SUB_END + 1, int(np.ceil(800.0 / BIN_HZ)))
B_HIGHMID_END = max(B_LOWMID_END + 1, int(np.ceil(3200.0 / BIN_HZ)))
B_TREBLE_END = min(len(RFFT_FREQS), int(np.ceil(10000.0 / BIN_HZ)))

# High-frequency spectral centroid band: 800 - 8000 Hz
B_CENT_START = max(1, int(np.floor(800.0 / BIN_HZ)))
B_CENT_END = min(len(RFFT_FREQS), int(np.ceil(8000.0 / BIN_HZ)))
CENT_FREQS = RFFT_FREQS[B_CENT_START:B_CENT_END]


def resolve_cut_window(
    song_index: int,
    manifest_song: dict[str, Any],
    total_dur: float,
) -> tuple[float, float]:
    """Determines [clipStart, clipEnd] for a rhythm game stage."""
    clip = manifest_song.get("clip") or {}
    c_start = clip.get("start")
    c_end = clip.get("end")
    if c_start is not None and c_end is not None and float(c_end) > float(c_start) + 15.0:
        start = float(c_start)
        end = min(float(c_end), round(total_dur, 1))
        return round(start, 1), round(end, 1)

    if song_index in SPECIAL_TREATMENT_CUTS:
        s, e = SPECIAL_TREATMENT_CUTS[song_index]
        end = min(float(e), round(total_dur, 1))
        start = min(float(s), max(0.0, end - 30.0))
        return round(start, 1), round(end, 1)

    if total_dur > 150.0:
        start = max(0.0, float(round((total_dur - 130.0) * 0.35)))
        end = min(round(total_dur, 1), start + 130.0)
        return round(start, 1), round(end, 1)

    return 0.0, round(total_dur, 1)


def decode_audio_cut(opus_path: Path, clip_start: float, clip_dur: float) -> np.ndarray:
    """Decodes [clip_start, clip_start + clip_dur] to 22050 Hz mono float32 PCM via ffmpeg."""
    cmd = [
        str(FFMPEG_BIN),
        "-v",
        "error",
        "-ss",
        f"{clip_start:.2f}",
        "-t",
        f"{clip_dur:.2f}",
        "-i",
        str(opus_path),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "f32le",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0 or len(proc.stdout) < FFT_SIZE * 4:
        return np.zeros(int(SAMPLE_RATE * max(10.0, clip_dur)), dtype=np.float32)
    return np.frombuffer(proc.stdout, dtype=np.float32)


def compute_waveform_peaks(samples: np.ndarray, num_peaks: int = 64) -> list[float]:
    """Computes 64 normalized waveform amplitude peaks (0..1) across the cut window."""
    if len(samples) < num_peaks:
        return [0.1] * num_peaks
    chunk = len(samples) // num_peaks
    trimmed = np.abs(samples[: chunk * num_peaks]).reshape(num_peaks, chunk)
    # Use 95th percentile per bucket to capture musical dynamics without single-sample spikes flattening the curve
    peaks = np.percentile(trimmed, 96, axis=1)
    max_val = float(np.max(peaks))
    if max_val < 1e-5:
        return [0.05] * num_peaks
    return [round(float(x / max_val), 2) for x in peaks]


def estimate_bpm_and_phase(
    total_flux: np.ndarray,
    sub_flux: np.ndarray,
    song_index: int,
) -> tuple[int, float]:
    """Estimates BPM in [90..200] (or uses KNOWN_BPMS override) and finds optimal beat grid phase offset."""
    if song_index in KNOWN_BPMS:
        bpm = KNOWN_BPMS[song_index]
    else:
        # Use up to 65 seconds from the active middle of the cut for autocorrelation
        n_frames = len(total_flux)
        start_f = min(int(FRAME_RATE * 4), n_frames // 6)
        end_f = min(n_frames, start_f + int(FRAME_RATE * 65))
        seg = total_flux[start_f:end_f].astype(np.float64)
        seg = seg - np.mean(seg)
        norm = np.dot(seg, seg)
        if norm < 1e-8:
            bpm = 128
        else:
            # FFT-based fast autocorrelation
            n_fft = 1 << (2 * len(seg) - 1).bit_length()
            spec = np.fft.rfft(seg, n=n_fft)
            acorr = np.fft.irfft(spec * np.conj(spec), n=n_fft)[: len(seg)] / norm

            best_score = -1e9
            best_bpm = 128
            for cand_bpm in range(90, 201):
                lag = (FRAME_RATE * 60.0) / cand_bpm
                lag1 = int(round(lag))
                lag2 = int(round(lag * 2))
                lag_half = int(round(lag * 0.5))
                if lag1 >= len(acorr):
                    continue
                # Comb filter over 1x, 2x, and 0.5x beat lags
                c1 = float(acorr[lag1])
                c2 = float(acorr[lag2]) if lag2 < len(acorr) else 0.0
                ch = float(acorr[lag_half]) if lag_half < len(acorr) else 0.0
                # Gentle Rayleigh-like tempo preference centered near 132 BPM
                prior = math.exp(-0.5 * ((cand_bpm - 132.0) / 48.0) ** 2)
                score = (c1 + 0.5 * c2 + 0.25 * ch) * (0.75 + 0.25 * prior)
                if score > best_score:
                    best_score = score
                    best_bpm = cand_bpm
            bpm = best_bpm

    beat_sec = 60.0 / bpm
    # Search 60 candidate phase offsets in [0, beat_sec) to maximize onset flux on quarter-note beats
    combined = total_flux + 0.6 * sub_flux
    num_phases = 60
    best_offset = 0.0
    best_phase_energy = -1.0
    max_dur = len(total_flux) / FRAME_RATE

    beat_indices = np.arange(2, int(max_dur / beat_sec) - 2, dtype=np.float64)
    if len(beat_indices) > 0:
        for p_idx in range(num_phases):
            cand_offset = (p_idx / num_phases) * beat_sec
            times = cand_offset + beat_indices * beat_sec
            f_idxs = np.clip(np.round(times * FRAME_RATE).astype(int), 0, len(combined) - 1)
            # Sum flux in a 3-frame window around each beat tick
            f_prev = np.clip(f_idxs - 1, 0, len(combined) - 1)
            f_next = np.clip(f_idxs + 1, 0, len(combined) - 1)
            energy = float(np.sum(np.maximum(combined[f_idxs], np.maximum(combined[f_prev], combined[f_next]))))
            if energy > best_phase_energy:
                best_phase_energy = energy
                best_offset = cand_offset

    return bpm, round(best_offset, 4)


def detect_major_drops(
    rms: np.ndarray,
    sub_flux: np.ndarray,
    total_flux: np.ndarray,
    duration: float,
) -> list[float]:
    """Detects 3 to 6 major bass/chorus drops across the stage duration."""
    n_frames = len(rms)
    win = max(4, int(FRAME_RATE * 3.5))
    drops: list[tuple[float, float]] = []

    min_f = int(FRAME_RATE * 8.0)
    max_f = min(n_frames - win, int(FRAME_RATE * (duration - 9.0)))

    # Smooth envelope in 0.5s windows
    hop_check = max(1, int(FRAME_RATE * 0.25))
    for f in range(min_f, max_f, hop_check):
        pre_rms = float(np.mean(rms[max(0, f - win) : f])) + 1e-5
        post_rms = float(np.mean(rms[f : min(n_frames, f + win)]))
        post_sub = float(np.mean(sub_flux[f : min(n_frames, f + int(FRAME_RATE * 1.5))]))
        pre_sub = float(np.mean(sub_flux[max(0, f - win) : f])) + 1e-5

        contrast = (post_rms / pre_rms) * 0.55 + (post_sub / pre_sub) * 0.45
        # Also weight by instantaneous peak flux near f
        local_peak = float(np.max(total_flux[max(0, f - 3) : min(n_frames, f + 4)]))
        score = contrast * (1.0 + 0.35 * local_peak)
        drops.append((score, round(f / FRAME_RATE, 2)))

    # Sort candidates by score descending and pick spaced drops (>= 16.0s apart)
    drops.sort(key=lambda x: x[0], reverse=True)
    selected: list[float] = []
    for _score, t_sec in drops:
        if all(abs(t_sec - existing) >= 16.0 for existing in selected):
            selected.append(t_sec)
            if len(selected) >= 5:
                break

    if not selected and duration > 30.0:
        selected = [round(duration * 0.25, 2), round(duration * 0.55, 2), round(duration * 0.8, 2)]

    selected.sort()
    return selected


def analyze_single_song(
    song_index: int,
    manifest_song: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    """Performs full multi-band DSP analysis & NoteSight grid chart generation for one song."""
    file_stem = manifest_song["fileName"]
    opus_path = ORIGINALS_DIR / f"{file_stem}.opus"
    total_dur = float(OggOpus(opus_path).info.length)

    clip_start, clip_end = resolve_cut_window(song_index, manifest_song, total_dur)
    clip_dur = round(max(15.0, clip_end - clip_start), 1)

    samples = decode_audio_cut(opus_path, clip_start, clip_dur)
    actual_dur = round(len(samples) / SAMPLE_RATE, 1)
    if actual_dur < 12.0:
        actual_dur = clip_dur

    peaks = compute_waveform_peaks(samples, num_peaks=64)

    # Strided framing for vectorized RFFT
    if len(samples) < FFT_SIZE + HOP_SIZE * 4:
        samples = np.pad(samples, (0, FFT_SIZE + HOP_SIZE * 4 - len(samples)))

    frames = np.lib.stride_tricks.sliding_window_view(samples, FFT_SIZE)[::HOP_SIZE]
    windowed = frames * HANNING_WINDOW
    mag = np.abs(np.fft.rfft(windowed, axis=1)).astype(np.float32)
    n_frames = len(mag)

    # Per-frame RMS energy
    rms = np.sqrt(np.mean(frames.astype(np.float32) ** 2, axis=1))
    max_rms = float(np.percentile(rms, 98)) + 1e-6
    rms_norm = rms / max_rms

    # Half-wave rectified spectral flux in 4 frequency bands
    diff = np.maximum(0.0, mag[1:] - mag[:-1])
    diff = np.vstack([np.zeros((1, mag.shape[1]), dtype=np.float32), diff])

    flux_sub = np.sum(diff[:, B_SUB_START:B_SUB_END], axis=1)
    flux_lowmid = np.sum(diff[:, B_SUB_END:B_LOWMID_END], axis=1)
    flux_highmid = np.sum(diff[:, B_LOWMID_END:B_HIGHMID_END], axis=1)
    flux_treble = np.sum(diff[:, B_HIGHMID_END:B_TREBLE_END], axis=1)

    # Normalize each band by its 95th percentile so band comparisons are well-calibrated across genres
    s_scale = float(np.percentile(flux_sub, 95)) + 1e-5
    lm_scale = float(np.percentile(flux_lowmid, 95)) + 1e-5
    hm_scale = float(np.percentile(flux_highmid, 95)) + 1e-5
    tr_scale = float(np.percentile(flux_treble, 95)) + 1e-5

    f_sub_n = flux_sub / s_scale
    f_lm_n = flux_lowmid / lm_scale
    f_hm_n = flux_highmid / hm_scale
    f_tr_n = flux_treble / tr_scale

    total_flux = (
        0.38 * f_sub_n
        + 0.28 * f_lm_n
        + 0.22 * f_hm_n
        + 0.12 * f_tr_n
    ).astype(np.float32)

    # High-frequency spectral centroid (800 - 8000 Hz)
    cent_mag = mag[:, B_CENT_START:B_CENT_END]
    cent_sum = np.sum(cent_mag, axis=1) + 1e-5
    centroid_hz = np.sum(cent_mag * CENT_FREQS, axis=1) / cent_sum
    cent_median = float(np.median(centroid_hz))
    cent_iqr = float(np.percentile(centroid_hz, 75) - np.percentile(centroid_hz, 25)) + 100.0

    # Estimate BPM and optimal beat-grid phase offset
    bpm, offset_sec = estimate_bpm_and_phase(total_flux, f_sub_n, song_index)
    beat_sec = 60.0 / bpm
    step16_sec = beat_sec / 4.0

    # Detect major chorus/bass drops
    drops = detect_major_drops(rms_norm, f_sub_n, total_flux, actual_dur)

    # Precompute local adaptive mean & std over a 3.0s sliding window (~129 frames)
    half_win = max(6, int(round(1.5 * FRAME_RATE)))
    kernel_size = 2 * half_win + 1
    kernel = np.ones(kernel_size, dtype=np.float32) / kernel_size
    local_mean = np.convolve(total_flux, kernel, mode="same")
    local_mean = np.maximum(local_mean, 0.05)

    # Evaluate 16th-note beat grid steps from t = 1.2s to actual_dur - 1.5s
    max_steps = int((actual_dur - 1.5 - offset_sec) / step16_sec)
    min_step = max(0, int(math.ceil((1.2 - offset_sec) / step16_sec)))

    # First pass: collect candidate onsets snapped to the 16th-note beat grid
    candidates: list[dict[str, Any]] = []
    for step16 in range(min_step, max_steps):
        t_grid = offset_sec + step16 * step16_sec
        if t_grid < 1.2 or t_grid > actual_dur - 1.5:
            continue

        f_center = int(round(t_grid * FRAME_RATE))
        if f_center < 2 or f_center >= n_frames - 4:
            continue

        # Peak pick within +-1 frame of the grid point
        f0 = max(1, f_center - 1)
        f1 = min(n_frames - 2, f_center + 1)
        f_peak = f0 + int(np.argmax(total_flux[f0 : f1 + 1]))

        val = float(total_flux[f_peak])
        l_mean = float(local_mean[f_peak])
        intensity_ratio = val / l_mean

        # Metric salience weight based on 16th-note position within the bar
        mod4 = step16 % 4
        mod16 = step16 % 16
        if mod16 == 0:
            metric_weight = 1.25  # Bar downbeat
        elif mod4 == 0:
            metric_weight = 1.12  # Quarter-note beat
        elif mod4 == 2:
            metric_weight = 0.96  # 8th-note upbeat
        else:
            metric_weight = 0.82  # 16th-note subdivision

        salience = intensity_ratio * metric_weight

        # Check if this grid step is an active onset
        is_local_max = val >= float(total_flux[f_peak - 1]) * 0.92 and val >= float(total_flux[f_peak + 1]) * 0.92
        min_ratio = 0.88 if mod4 == 0 else (1.04 if mod4 == 2 else 1.18)

        if is_local_max and intensity_ratio >= min_ratio and val > 0.08:
            candidates.append(
                {
                    "step16": step16,
                    "time": round(t_grid, 3),
                    "frame": f_peak,
                    "val": val,
                    "intensity_ratio": intensity_ratio,
                    "salience": salience,
                    "sub": float(f_sub_n[f_peak]),
                    "lm": float(f_lm_n[f_peak]),
                    "hm": float(f_hm_n[f_peak]),
                    "tr": float(f_tr_n[f_peak]),
                    "rms": float(rms_norm[f_peak]),
                }
            )

    # Guarantee sufficient musical density even on very smooth ambient/acoustic tracks
    if len(candidates) < int(actual_dur * 1.4):
        existing_steps = {c["step16"] for c in candidates}
        for step16 in range(min_step, max_steps, 2):
            if step16 in existing_steps:
                continue
            t_grid = offset_sec + step16 * step16_sec
            if t_grid < 1.2 or t_grid > actual_dur - 1.5:
                continue
            f_peak = int(np.clip(round(t_grid * FRAME_RATE), 2, n_frames - 4))
            val = float(total_flux[f_peak])
            l_mean = float(local_mean[f_peak])
            intensity_ratio = val / l_mean
            if intensity_ratio >= 0.72:
                candidates.append(
                    {
                        "step16": step16,
                        "time": round(t_grid, 3),
                        "frame": f_peak,
                        "val": val,
                        "intensity_ratio": intensity_ratio,
                        "salience": intensity_ratio * (1.1 if step16 % 4 == 0 else 0.9),
                        "sub": float(f_sub_n[f_peak]),
                        "lm": float(f_lm_n[f_peak]),
                        "hm": float(f_hm_n[f_peak]),
                        "tr": float(f_tr_n[f_peak]),
                        "rms": float(rms_norm[f_peak]),
                    }
                )
        candidates.sort(key=lambda c: c["step16"])

    # Second pass: Acoustic Feature-Driven Note Classification & Multi-Tier Assignment
    # events tuple format: [timeSec, durationSec, typeCode, dirIdx, tier]
    events: list[list[float | int]] = []

    last_tier_end: dict[int, float] = {1: -999.0, 2: -999.0, 3: -999.0, 4: -999.0}
    last_global_sustain_end = -999.0
    last_rush_time = -999.0
    last_hold_time = -999.0
    last_adlib_time = -999.0
    slide_phrase_idx = 0

    # Minimum spacing per difficulty tier so filtering `tier <= k` yields optimal readability
    tier_min_gap = {
        1: max(0.46, beat_sec * 0.92),  # Easy (~1 beat / 2 beats)
        2: max(0.28, beat_sec * 0.48),  # Normal (~1/2 to 1 beat)
        3: max(0.19, beat_sec * 0.24),  # Hard (~1/2 to 1/4 beat)
        4: max(0.12, step16_sec * 0.92),  # Master (1/4 beat 16th streams)
    }

    for idx, cand in enumerate(candidates):
        t = cand["time"]
        f = cand["frame"]
        step16 = cand["step16"]
        mod4 = step16 % 4
        mod8 = step16 % 8
        intensity_ratio = cand["intensity_ratio"]
        sub_v = cand["sub"]
        lm_v = cand["lm"]
        hm_v = cand["hm"]
        tr_v = cand["tr"]
        rms_v = cand["rms"]

        # Never spawn any note inside an active hold or spin/rush tail across ANY tier
        if t < last_global_sustain_end + 0.18:
            continue

        # Check if this is a syncopated off-beat candidate for Bonus Ad-Lib ('adlib' = 10 or 'invisible' = 9)
        if (
            step16 % 2 == 1
            and 1.02 <= intensity_ratio <= 1.46
            and t - last_adlib_time >= max(1.6, beat_sec * 3.0)
            and t - last_tier_end[2] >= 0.18
        ):
            # Ensure next candidate is also at least 0.18s away
            next_t = candidates[idx + 1]["time"] if idx + 1 < len(candidates) else 9999.0
            if next_t - t >= 0.18:
                is_invisible = (tr_v > hm_v * 0.95 and intensity_ratio < 1.26) or (step16 % 4 == 3 and tr_v > 0.55)
                type_code = 9 if is_invisible else 10
                tier = 3 if is_invisible else 2
                events.append([round(t, 2), 0, type_code, -1, tier])
                last_adlib_time = t
                continue

        # Determine the highest importance tier (1 = Easy .. 4 = Master) this onset qualifies for
        tier = 0
        if (
            (mod8 == 0 or (mod4 == 0 and intensity_ratio >= 1.32))
            and t - last_tier_end[1] >= tier_min_gap[1]
        ):
            tier = 1
        elif (
            (mod4 == 0 or (step16 % 2 == 0 and intensity_ratio >= 1.22))
            and t - last_tier_end[2] >= tier_min_gap[2]
        ):
            tier = 2
        elif (
            (step16 % 2 == 0 or intensity_ratio >= 1.28)
            and t - last_tier_end[3] >= tier_min_gap[3]
        ):
            tier = 3
        elif t - last_tier_end[4] >= tier_min_gap[4]:
            tier = 4

        if tier == 0:
            continue

        # 1. Check for Spin / Scratch & Spam Rush burst (spaced >= 14.5s apart)
        burst_frames = int(round(beat_sec * 3.0 * FRAME_RATE))
        if (
            tier <= 2
            and mod4 == 0
            and t - last_rush_time >= 14.5
            and t + beat_sec * 3.5 < actual_dur - 2.5
            and f + burst_frames < n_frames
        ):
            burst_flux = total_flux[f : f + burst_frames]
            burst_density = float(np.mean(burst_flux > local_mean[f : f + burst_frames] * 1.12))
            burst_var = float(np.std(burst_flux) / (np.mean(burst_flux) + 1e-5))
            if (burst_density >= 0.36 or burst_var >= 0.62) and intensity_ratio >= 1.35:
                rush_dur = round(min(2.2, max(0.9, beat_sec * 3.0)), 2)
                # Classify spin vs dual_scratch vs spam_rush from burst spectral profile
                cent_burst_std = float(np.std(centroid_hz[f : f + burst_frames]))
                sub_burst = float(np.mean(f_sub_n[f : f + burst_frames]))
                hm_burst = float(np.mean(f_hm_n[f : f + burst_frames]))
                if sub_burst > 0.52 and hm_burst > 0.50:
                    rush_type = 8  # dual_scratch
                elif cent_burst_std > cent_iqr * 0.52:
                    rush_type = 7  # scratch
                else:
                    rush_type = 6  # spam_rush

                events.append([round(t, 2), rush_dur, rush_type, -1, tier])
                end_t = t + rush_dur
                last_global_sustain_end = end_t
                last_rush_time = end_t
                for k in range(tier, 5):
                    last_tier_end[k] = max(last_tier_end[k], end_t)
                continue

        # 2. Check for Sustain / Hold via continuous post-onset RMS envelope tracking
        min_hold_sec = max(0.38, beat_sec * 1.0)
        max_hold_sec = min(2.4, beat_sec * 3.0)
        min_hold_frames = max(4, int(round(min_hold_sec * FRAME_RATE)))
        max_hold_frames = min(n_frames - f - 1, int(round(max_hold_sec * FRAME_RATE)))

        sustain_frames = 0
        # Reference RMS right after the initial transient peak (frames f..f+3)
        ref_rms = float(np.mean(rms_norm[f : min(n_frames, f + 3)]))
        rms_thresh = 0.62 * max(rms_v * 0.9, ref_rms)
        sharp_interrupt_thresh = max(cand["val"] * 1.65, float(local_mean[f]) * 2.35)

        if (
            tier <= 3
            and t - last_hold_time >= max(2.2, beat_sec * 4.0)
            and ref_rms >= 0.18
            and max_hold_frames >= min_hold_frames
        ):
            for df in range(1, max_hold_frames + 1):
                curr_rms = float(rms_norm[f + df])
                curr_flux = float(total_flux[f + df])
                # Allow 1-frame dip by checking 2-frame average
                avg2_rms = 0.5 * (curr_rms + float(rms_norm[min(n_frames - 1, f + df + 1)]))
                if avg2_rms < rms_thresh:
                    break
                if df >= min_hold_frames // 2 and curr_flux > sharp_interrupt_thresh:
                    break
                sustain_frames = df

        # Compute Spectral Centroid pitch-sweep slope over [t - 0.08s, t + 0.18s]
        f_pre = max(0, f - int(round(0.08 * FRAME_RATE)))
        f_post = min(n_frames - 1, f + int(round(0.18 * FRAME_RATE)))
        delta_centroid = float(centroid_hz[f_post] - centroid_hz[f_pre])
        norm_slope = delta_centroid / cent_iqr
        high_to_low_ratio = (hm_v + tr_v) / (sub_v + lm_v + 0.15)

        # Map acoustic pitch slope + spectral balance into a 16-way SlideDirection index (0..15)
        is_directional = (
            abs(norm_slope) >= 0.48
            or (high_to_low_ratio >= 1.48 and intensity_ratio >= 1.38)
        )
        dir_idx = -1
        if is_directional:
            # Compute a smooth 2D acoustic vector (dx = mid/bass balance + phrase flow, dy = pitch slope)
            phrase_osc = math.cos(slide_phrase_idx * 0.85 + step16 * 0.25)
            dx = (hm_v - lm_v) * 0.8 + phrase_osc * 0.65
            dy = np.clip(norm_slope * 1.6, -1.5, 1.5) + math.sin(slide_phrase_idx * 1.1) * 0.35
            angle = math.atan2(dy, dx)
            if angle < 0:
                angle += 2.0 * math.pi
            dir_idx = int(round(angle / (math.pi / 8.0))) % 16
            slide_phrase_idx += 1

        is_dual_impact = (
            mod4 == 0
            and intensity_ratio >= 2.05
            and sub_v >= 0.82
            and max(lm_v, hm_v) >= 0.75
        )

        # If sustained for at least 1.0 * beat_sec, emit a hold / dual_hold / hold_slide
        if sustain_frames >= min_hold_frames:
            raw_hold_sec = sustain_frames / FRAME_RATE
            half_beat = beat_sec * 0.5
            quant_hold = round(raw_hold_sec / half_beat) * half_beat
            hold_dur = round(float(np.clip(quant_hold, beat_sec * 1.0, min(2.4, beat_sec * 3.0))), 2)

            if is_dual_impact:
                hold_type = 2  # dual_hold
                hold_dir = -1
            elif is_directional:
                hold_type = 3  # hold_slide
                hold_dir = dir_idx if dir_idx >= 0 else (step16 % 16)
            else:
                hold_type = 1  # hold
                hold_dir = -1

            events.append([round(t, 2), hold_dur, hold_type, hold_dir, tier])
            end_t = t + hold_dur
            last_global_sustain_end = end_t
            last_hold_time = end_t
            for k in range(tier, 5):
                last_tier_end[k] = max(last_tier_end[k], end_t)
            continue

        # 3. Non-sustained onset classification: dual_tap (5), beat_strike (4), or tap (0)
        if is_dual_impact and tier <= 3:
            type_code = 5  # dual_tap
            final_dir = -1
        elif is_directional and (mod4 == 0 or step16 % 2 == 0):
            type_code = 4  # beat_strike
            final_dir = dir_idx if dir_idx >= 0 else (step16 % 16)
        else:
            type_code = 0  # tap
            final_dir = -1

        events.append([round(t, 2), 0, type_code, final_dir, tier])
        for k in range(tier, 5):
            last_tier_end[k] = max(last_tier_end[k], t)

    chart_entry = {
        "songIndex": song_index,
        "trackId": manifest_song["id"],
        "bpm": bpm,
        "clipStart": clip_start,
        "clipEnd": round(clip_start + actual_dur, 1),
        "duration": actual_dur,
        "peaks": peaks,
        "drops": drops,
        "events": events,
    }
    return song_index, chart_entry


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Build 300 real DSP rhythm game charts.")
    parser.add_argument("--workers", type=int, default=12, help="Number of parallel worker threads")
    args = parser.parse_args()

    t_start = time.time()
    manifest_data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    songs = manifest_data["songs"]
    assert len(songs) == 300, f"Expected 300 songs in manifest.json, got {len(songs)}"

    print(f"Analyzing 300 Opus files in {ORIGINALS_DIR} with {args.workers} workers...")
    charts: dict[str, dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(analyze_single_song, idx, song): idx
            for idx, song in enumerate(songs, start=1)
        }
        completed = 0
        for fut in as_completed(futures):
            idx, entry = fut.result()
            charts[str(idx)] = entry
            completed += 1
            if completed % 25 == 0 or completed == 300:
                elapsed = time.time() - t_start
                print(
                    f"  [{completed:3d}/300] ({elapsed:5.1f}s) Latest: #{idx:03d} ({entry['trackId']}) "
                    f"BPM={entry['bpm']} cut={entry['clipStart']}..{entry['clipEnd']}s events={len(entry['events'])}",
                    flush=True,
                )

    # Sort dictionary keys numerically "1".."300"
    ordered_charts = {str(i): charts[str(i)] for i in range(1, 301)}

    payload = {
        "version": 1,
        "schema": {
            "eventTuple": ["timeSec", "durationSec", "typeCode", "dirIdx", "tier"],
            "typeMap": {str(k): v for k, v in TYPE_MAP.items()},
            "dirMap": {str(i): d for i, d in enumerate(SLIDE_DIRECTIONS_16)},
            "tierMap": {
                "1": "Easy (core downbeats, tier <= 1)",
                "2": "Normal (quarter beats & key syncopations, tier <= 2)",
                "3": "Hard (eighth-note grooves & accents, tier <= 3)",
                "4": "Master (sixteenth-note streams & technical patterns, tier <= 4)",
            },
        },
        "charts": ordered_charts,
    }

    OUTPUT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Write compact JSON to keep all 300 songs under ~1.8 MB
    raw_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    OUTPUT_JSON_PATH.write_text(raw_json, encoding="utf-8")

    size_mb = OUTPUT_JSON_PATH.stat().st_size / (1024 * 1024)
    total_events = sum(len(c["events"]) for c in ordered_charts.values())
    print(
        f"\nDone in {time.time() - t_start:.1f}s! Wrote {OUTPUT_JSON_PATH} "
        f"({size_mb:.2f} MB, 300 charts, {total_events:,} total audio-analyzed note events)."
    )


if __name__ == "__main__":
    main()
