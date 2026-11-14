import os
import subprocess
from PIL import Image

APP_DIR = os.path.abspath('app')
ELECTRON_EXE = os.path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

def render_svg_to_png(svg_path, output_png_path, size=512):
    """Render an SVG to a high-resolution PNG using Electron headless offscreen window."""
    script_content = f"""
const {{ app, BrowserWindow }} = require('electron');
const fs = require('fs');
const path = require('path');

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
  
  const svgUrl = 'file:///' + {repr(svg_path.replace(os.sep, '/'))};
  await win.loadURL(svgUrl);
  await new Promise(r => setTimeout(r, 600));
  const image = await win.capturePage({{ x: 0, y: 0, width: {size}, height: {size} }});
  fs.writeFileSync({repr(output_png_path.replace(os.sep, '/'))}, image.toPNG());
  app.quit();
}});
"""
    tmp_script = os.path.join(APP_DIR, '_tmp_render.cjs')
    with open(tmp_script, 'w', encoding='utf-8') as f:
        f.write(script_content)

    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)

    try:
        res = subprocess.run([ELECTRON_EXE, tmp_script], cwd=APP_DIR, env=env, capture_output=True, text=True)
        if res.returncode != 0:
            print("Electron error:", res.stderr)
            return False
        return os.path.exists(output_png_path)
    finally:
        if os.path.exists(tmp_script):
            os.remove(tmp_script)

if __name__ == '__main__':
    print("Renderer utility loaded")

