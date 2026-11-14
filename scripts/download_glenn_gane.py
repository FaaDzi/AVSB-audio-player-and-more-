"""Download audio, low-res video (for switch timing & intro slides), and comments for 5CDhlgpjk20."""
import json
import subprocess
import sys
from pathlib import Path
import yt_dlp

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
OUT_DIR = ROOT / "data" / "raw" / "glenn_gane"
OUT_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_URL = "https://www.youtube.com/watch?v=5CDhlgpjk20"

def main():
    # 1. Download best audio
    audio_out = OUT_DIR / "5CDhlgpjk20_audio.%(ext)s"
    ydl_audio_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(audio_out),
        "quiet": False,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_audio_opts) as ydl:
        info = ydl.extract_info(VIDEO_URL, download=True)
        audio_file = Path(ydl.prepare_filename(info))
        print("Downloaded audio:", audio_file, "format:", info.get("format"), "abr:", info.get("abr"), "asr:", info.get("asr"))

    # Convert to 48kHz stereo float32 or 16-bit WAV
    wav_path = OUT_DIR / "audio_48k.wav"
    subprocess.run([
        str(FFMPEG), "-v", "error", "-y", "-i", str(audio_file),
        "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", str(wav_path)
    ], check=True)
    print("Converted to 48kHz stereo float32 WAV:", wav_path)

    # 2. Download 360p/480p video for visual switch detection
    vid_out = OUT_DIR / "5CDhlgpjk20_vid.mp4"
    if not vid_out.exists():
        ydl_vid_opts = {
            "format": "bestvideo[height<=480][ext=mp4]/best[height<=480]",
            "outtmpl": str(vid_out),
            "quiet": False,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_vid_opts) as ydl:
            ydl.download([VIDEO_URL])
        print("Downloaded video:", vid_out)

    # 3. Fetch top comments
    ydl_comment_opts = {
        "quiet": True,
        "no_warnings": True,
        "getcomments": True,
        "extractor_args": {"youtube": {"max_comments": ["50", "all", "50", "10"]}},
    }
    try:
        with yt_dlp.YoutubeDL(ydl_comment_opts) as ydl:
            cinfo = ydl.extract_info(VIDEO_URL, download=False)
            comments = cinfo.get("comments") or []
            (OUT_DIR / "comments_5CDhlgpjk20.json").write_text(
                json.dumps(comments[:50], indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(f"Fetched {len(comments)} comments.")
            for c in comments[:15]:
                print(f"  [{c.get('author')} (likes: {c.get('like_count')})]: {c.get('text')[:200]}")
    except Exception as e:
        print("Comment fetch error:", e)

if __name__ == "__main__":
    main()

