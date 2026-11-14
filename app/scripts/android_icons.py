"""Android launcher icons from the exe's icon (public/icon.png, the same art as public/icon.ico), so the
phone shows the same framed A⚡B card as the Windows app.

- ic_launcher / ic_launcher_round (pre-Android 8, and some launchers): the icon itself.
- adaptive icon (Android 8+): the foreground is the whole icon scaled to the 72 dp of the 108 dp layer that
  launchers show through their mask; the background is the frame's own purple, so any mask edge blends in.

Usage (from app/): python -I scripts/android_icons.py
"""
from pathlib import Path

from PIL import Image

APP = Path(__file__).resolve().parent.parent
RES = APP / "android" / "app" / "src" / "main" / "res"
SRC = APP / "public" / "icon.png"
DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
FRAME = "#0e071b"  # the icon's frame colour, sampled from icon.png


def main():
    icon = Image.open(SRC).convert("RGBA")
    for d, k in DENSITY.items():
        out = RES / f"mipmap-{d}"
        legacy = round(48 * k)
        small = icon.resize((legacy, legacy), Image.LANCZOS)
        small.save(out / "ic_launcher.png")
        small.save(out / "ic_launcher_round.png")
        layer = round(108 * k)
        inner = round(72 * k)
        fg = Image.new("RGBA", (layer, layer), (0, 0, 0, 0))
        fg.paste(icon.resize((inner, inner), Image.LANCZOS), ((layer - inner) // 2, (layer - inner) // 2))
        fg.save(out / "ic_launcher_foreground.png")
    # its own colour: ic_launcher_background is also the splash screen's, which stays as it is
    (RES / "values" / "ic_launcher_frame.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_frame">{FRAME}</color>\n</resources>\n',
        encoding="utf-8",
    )
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        p = RES / "mipmap-anydpi-v26" / name
        p.write_text(p.read_text(encoding="utf-8").replace("@color/ic_launcher_background", "@color/ic_launcher_frame"), encoding="utf-8")
    print("icons written for", ", ".join(DENSITY))


if __name__ == "__main__":
    main()
