"""Fetch metadata, description, chapters, and audio of Glenn Gane Audio video 5CDhlgpjk20."""
import json
import sys
from pathlib import Path
import yt_dlp

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "raw" / "glenn_gane"
OUT_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_URL = "https://www.youtube.com/watch?v=5CDhlgpjk20"

def main():
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(VIDEO_URL, download=False)
        meta = {
            "id": info.get("id"),
            "title": info.get("title"),
            "uploader": info.get("uploader"),
            "upload_date": info.get("upload_date"),
            "duration": info.get("duration"),
            "view_count": info.get("view_count"),
            "like_count": info.get("like_count"),
            "description": info.get("description"),
            "chapters": info.get("chapters"),
            "tags": info.get("tags"),
        }
        (OUT_DIR / "meta_5CDhlgpjk20.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print("Title:", meta["title"])
        print("Uploader:", meta["uploader"])
        print("Duration:", meta["duration"], "s")
        print("\n--- Description ---")
        print(meta["description"])
        print("\n--- Chapters ---")
        print(json.dumps(meta["chapters"], indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()

