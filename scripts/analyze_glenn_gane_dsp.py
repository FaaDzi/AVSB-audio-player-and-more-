"""Comprehensive acoustic & DSP comparison between Glenn Gane Audio (5CDhlgpjk20) and our App's Simulation Engine.

Video: Crinear Daybreak vs Simgot Supermix 4 (https://youtu.be/5CDhlgpjk20)
"""
import json
import subprocess
import sys
from pathlib import Path
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import frcodec

FFMPEG = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
RAW_DIR = ROOT / "data" / "raw" / "glenn_gane"
VID_PATH = RAW_DIR / "5CDhlgpjk20_vid.mp4"
WAV_PATH = RAW_DIR / "audio_48k.wav"


def load_catalog_curves():
    iems = json.loads((ROOT / "app/public/data/iems.json").read_text(encoding="utf-8"))
    refs = json.loads((ROOT / "app/public/data/refs.json").read_text(encoding="utf-8"))
    grid = np.asarray(iems["grid"], dtype=float)
    scale = float(iems.get("frScale", 0.1))

    found = {}
    for item in iems["iems"]:
        low_id = item["id"].lower()
        low_name = item["name"].lower()
        if "daybreak" in low_id or "daybreak" in low_name or "supermix" in low_id or "supermix" in low_name:
            ref_entry = refs.get("refs", {}).get(item["id"])
            ref_fr = frcodec.decode(ref_entry["fr"]) * scale if ref_entry else None
            found[item["id"]] = {
                "id": item["id"],
                "name": item["name"],
                "source": item.get("source"),
                "sources": item.get("sources", []),
                "fr": frcodec.decode(item["fr"]) * scale,
                "metrics": item.get("metrics", {}),
                "ref_fr": ref_fr,
                "ref_n": ref_entry.get("n") if ref_entry else 0,
                "ref_spread": ref_entry.get("spread") if ref_entry else None,
                "ref_sources": ref_entry.get("sources") if ref_entry else [],
            }
    return grid, iems["bands"], found


def detect_video_segments():
    """Extract top-banner strip at 4 fps and classify Maroon (Daybreak) vs Green (Supermix 4)."""
    W, H, FPS = 426, 240, 4
    cmd = [
        str(FFMPEG), "-v", "error", "-i", str(VID_PATH),
        "-vf", f"fps={FPS},scale={W}:{H}",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
    ]
    raw = subprocess.check_output(cmd)
    n_frames = len(raw) // (W * H * 3)
    frames = np.frombuffer(raw[:n_frames * W * H * 3], dtype=np.uint8).reshape((n_frames, H, W, 3))

    # Title text region in 426x240: y in [8..35], x in [110..315]
    roi = frames[:, 8:35, 110:315, :].astype(np.int32)
    maroon_px = np.sum((roi[:, :, :, 0] - roi[:, :, :, 1] > 30) & (roi[:, :, :, 1] < 120), axis=(1, 2))
    green_px = np.sum((roi[:, :, :, 1] - roi[:, :, :, 0] > 20) & (roi[:, :, :, 2] < 120), axis=(1, 2))

    labels = []
    for i in range(n_frames):
        t = i / FPS
        if t < 83.0:
            labels.append("intro")
        elif maroon_px[i] > 20 and maroon_px[i] > green_px[i]:
            labels.append("daybreak")
        elif green_px[i] > 20 and green_px[i] > maroon_px[i]:
            labels.append("supermix4")
        else:
            labels.append("unknown")

    segments = []
    if labels:
        cur = labels[0]
        start_idx = 0
        for i in range(1, len(labels)):
            if labels[i] != cur:
                segments.append({
                    "label": cur,
                    "start": round(start_idx / FPS, 2),
                    "end": round(i / FPS, 2),
                    "duration": round((i - start_idx) / FPS, 2),
                })
                cur = labels[i]
                start_idx = i
        segments.append({
            "label": cur,
            "start": round(start_idx / FPS, 2),
            "end": round(len(labels) / FPS, 2),
            "duration": round((len(labels) - start_idx) / FPS, 2),
        })
    return segments


def main():
    grid, bands, found = load_catalog_curves()
    print("=== Found Models in Our Database ===")
    for mid, info in sorted(found.items()):
        print(f"  ID: {mid:35} | Name: {info['name']:35} | Source: {info['source']} (all: {info['sources']})")
        print(f"    Metrics: {info['metrics']}")
        if info["ref_fr"] is not None:
            print(f"    Ref Curve: n={info['ref_n']}, spread={info['ref_spread']} dB, sources={info['ref_sources']}")

    print("\n=== Detecting Video Segments in 5CDhlgpjk20 ===")
    segments = detect_video_segments()
    clean_segs = [s for s in segments if s["duration"] >= 1.0 and s["label"] in ("daybreak", "supermix4")]
    print(f"Detected {len(clean_segs)} clean IEM playback segments:")
    for s in clean_segs[:25]:
        print(f"  {s['start']:6.2f}s - {s['end']:6.2f}s ({s['duration']:5.2f}s): {s['label']}")
    if len(clean_segs) > 25:
        print(f"  ... ({len(clean_segs) - 25} more segments)")

    (RAW_DIR / "segments_5CDhlgpjk20.json").write_text(json.dumps(clean_segs, indent=2), encoding="utf-8")

    tot_daybreak = sum(s["duration"] for s in clean_segs if s["label"] == "daybreak")
    tot_sm4 = sum(s["duration"] for s in clean_segs if s["label"] == "supermix4")
    print(f"Total CrinEar Daybreak time: {tot_daybreak:.1f}s | Total Simgot SuperMix 4 time: {tot_sm4:.1f}s")


if __name__ == "__main__":
    main()

