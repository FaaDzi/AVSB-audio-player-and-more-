import os
import shutil
import subprocess
from pathlib import Path
from PIL import Image

APP_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = APP_DIR / "public"
SVG_PATH = PUBLIC_DIR / "icon.svg"
PNG_PATH = PUBLIC_DIR / "icon.png"
ICO_PATH = PUBLIC_DIR / "icon.ico"
ELECTRON_EXE = APP_DIR / "node_modules" / "electron" / "dist" / "electron.exe"

def render_svg_to_png(svg_file: Path, png_file: Path, size=512):
    """Render SVG to 512x512 PNG using Electron headless window."""
    script = f"""
const {{ app, BrowserWindow }} = require('electron');
const fs = require('fs');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {{
  const win = new BrowserWindow({{
    width: {size},
    height: {size},
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {{ offscreen: true }}
  }});
  
  const svgUrl = 'file:///' + {repr(str(svg_file).replace(os.sep, '/'))};
  await win.loadURL(svgUrl);
  await new Promise(r => setTimeout(r, 600));
  const image = await win.capturePage({{ x: 0, y: 0, width: {size}, height: {size} }});
  fs.writeFileSync({repr(str(png_file).replace(os.sep, '/'))}, image.toPNG());
  app.quit();
}});
"""
    tmp_js = APP_DIR / "_tmp_build_render.cjs"
    tmp_js.write_text(script, encoding="utf-8")
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)

    try:
        res = subprocess.run([str(ELECTRON_EXE), str(tmp_js)], cwd=str(APP_DIR), env=env, capture_output=True, text=True)
        if res.returncode != 0:
            print("Electron error:", res.stderr)
            return False
        return png_file.exists() and png_file.stat().st_size > 0
    finally:
        if tmp_js.exists():
            tmp_js.unlink()

def main():
    print(f"[1/4] Rendering {SVG_PATH.name} -> {PNG_PATH.name} (512x512)...")
    ok = render_svg_to_png(SVG_PATH, PNG_PATH, 512)
    if not ok:
        raise RuntimeError("Failed to render SVG to PNG!")
    print(f"      Rendered: {PNG_PATH} ({PNG_PATH.stat().st_size} bytes)")

    print(f"[2/4] Generating multi-resolution {ICO_PATH.name}...")
    img = Image.open(PNG_PATH).convert("RGBA")
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(ICO_PATH, sizes=sizes)
    print(f"      Saved: {ICO_PATH} ({ICO_PATH.stat().st_size} bytes)")

    # Sync to dist if present
    dist_ico = APP_DIR / "dist" / "icon.ico"
    if dist_ico.parent.exists():
        shutil.copyfile(ICO_PATH, dist_ico)
        print(f"      Synced to {dist_ico}")

    print("[3/4] Updating android_icons.py FRAME color...")
    android_script = APP_DIR / "scripts" / "android_icons.py"
    text = android_script.read_text(encoding="utf-8")
    # Replace FRAME color with dark squircle obsidian
    text = text.replace('FRAME = "#281545"', 'FRAME = "#0e071b"')
    android_script.write_text(text, encoding="utf-8")

    print("[4/4] Generating Android launcher icons across all mipmap densities...")
    res = subprocess.run(["python", "-I", str(android_script)], cwd=str(APP_DIR), capture_output=True, text=True)
    print("      " + res.stdout.strip())
    if res.returncode != 0:
        print("Android icons error:", res.stderr)
        raise RuntimeError("Android icon generation failed!")

    print("\nAll icon assets successfully rebuilt!")

if __name__ == "__main__":
    main()

