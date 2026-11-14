"""Extract keyframes from 5CDhlgpjk20_vid.mp4 to inspect intro text, graphs, and switch timings."""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
OUT_DIR = ROOT / "data" / "raw" / "glenn_gane" / "frames"
OUT_DIR.mkdir(parents=True, exist_ok=True)
VID = ROOT / "data" / "raw" / "glenn_gane" / "5CDhlgpjk20_vid.mp4"

def main():
    # Extract 1 frame every 5 seconds during Intro (0..85s)
    for t in range(2, 85, 6):
        out = OUT_DIR / f"intro_{t:03d}s.jpg"
        subprocess.run([
            str(FFMPEG), "-v", "error", "-y", "-ss", str(t), "-i", str(VID),
            "-frames:v", "1", "-q:v", "2", str(out)
        ], check=True)
    # Extract 1 frame every 2 seconds during Track 1 (Funk Bassline: 83..135s) and Track 2 (135..175s)
    for t in range(83, 165, 2):
        out = OUT_DIR / f"track_{t:03d}s.jpg"
        subprocess.run([
            str(FFMPEG), "-v", "error", "-y", "-ss", str(t), "-i", str(VID),
            "-frames:v", "1", "-q:v", "3", str(out)
        ], check=True)
    print("Extracted frames to:", OUT_DIR)

if __name__ == "__main__":
    main()

