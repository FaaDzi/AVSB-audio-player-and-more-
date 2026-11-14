"""Inspect chapters of related Glenn Gane Audio videos to find exact time-aligned recordings of the same songs."""
import json
import sys
import yt_dlp

sys.stdout.reconfigure(encoding="utf-8")

VIDEOS = [
    "5CDhlgpjk20",  # Crinear Daybreak vs Simgot Supermix 4 (873s)
    "03VVacBowhI",  # Crinear Daybreak vs Letshuoer Galileo (873s)
    "t6LcBJMJIb4",  # Dunu 142 vs Simgot Supermix 4 (873s)
    "LeI_E5McA3c",  # InAwaken Twilight DS vs Truthear Hexa (873s)
    "6WsG-EhCofc",  # Crinear Daybreak vs Truthear Nova (898s)
    "jjH6HN2DZdU",  # ZiiGaat Arete 2 vs Simgot Supermix 4 (898s)
    "LY35NjUVXVE",  # Simgot Supermix 4 vs Truthear Nova (1125s)
    "TPxEfOah9Ic",  # Simgot Supermix 4 vs Truthear Hexa (766s)
    "qvg19MENMp4",  # Hisenior Mega5EST Bass vs Crinear Daybreak (373s)
]

def main():
    ydl_opts = {"quiet": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for vid in VIDEOS:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
            chaps = [(c["start_time"], c["title"]) for c in (info.get("chapters") or [])]
            print(f"\n=== {vid} ({info.get('duration')}s): {info.get('title')} ===")
            for st, t in chaps:
                print(f"  {st:6.0f}s: {t}")

if __name__ == "__main__":
    main()

