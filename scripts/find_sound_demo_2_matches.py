"""Find Glenn Gane Audio videos that use 'Sound demo [2]' (872-873s) or feature Supermix 4 / Daybreak in slot 1 vs slot 2."""
import json
import sys
import yt_dlp

sys.stdout.reconfigure(encoding="utf-8")

def main():
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
    }
    queries = [
        "ytsearch40:Glenn Gane Audio Supermix 4",
        "ytsearch40:Glenn Gane Audio Crinear Daybreak",
        "ytsearch40:Glenn Gane Audio Sound demo [2]",
    ]
    seen = {}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for q in queries:
            info = ydl.extract_info(q, download=False)
            for entry in info.get("entries", []):
                if entry and entry.get("id") not in seen:
                    seen[entry["id"]] = entry

    print(f"Total unique videos found: {len(seen)}")
    print("\n--- Videos with duration ~872-874s (Sound demo [2] template!) ---")
    for vid, e in seen.items():
        dur = e.get("duration") or 0
        if 865 <= dur <= 880:
            print(f"  {vid} | {dur}s | {e.get('title')}")

    print("\n--- All Supermix 4 / Daybreak videos ---")
    for vid, e in seen.items():
        title = str(e.get("title"))
        if "supermix" in title.lower() or "daybreak" in title.lower():
            print(f"  {vid} | {e.get('duration')}s | {title}")

if __name__ == "__main__":
    main()

