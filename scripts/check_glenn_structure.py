"""Check musical structure of 5CDhlgpjk20 and search Glenn Gane Audio's channel for other Daybreak / SuperMix 4 videos."""
import json
import sys
from pathlib import Path
import numpy as np
import yt_dlp

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw" / "glenn_gane"

def search_glenn_videos():
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
    }
    queries = [
        "ytsearch15:Glenn Gane Audio Crinear Daybreak",
        "ytsearch15:Glenn Gane Audio Simgot Supermix 4",
        "ytsearch15:Glenn Gane Audio IEM sound comparison",
    ]
    seen = {}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for q in queries:
            info = ydl.extract_info(q, download=False)
            for entry in info.get("entries", []):
                if entry and entry.get("id") not in seen:
                    seen[entry["id"]] = {
                        "id": entry.get("id"),
                        "title": entry.get("title"),
                        "channel": entry.get("channel") or entry.get("uploader"),
                        "duration": entry.get("duration"),
                    }
    print("=== Glenn Gane Audio Videos Found ===")
    for vid, v in seen.items():
        if "glenn" in str(v["channel"]).lower() or "vs" in str(v["title"]).lower():
            print(f"  {vid} | {v['duration']}s | {v['channel']} | {v['title']}")

if __name__ == "__main__":
    search_glenn_videos()

