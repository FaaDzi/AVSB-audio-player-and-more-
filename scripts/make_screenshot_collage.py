import os
from PIL import Image, ImageDraw

bundle_dir = r"D:\Project\VSCODE\Music Preferences\reference_screenshots\bundle_for_ai_studio"
artifact_dir = r"C:\Users\Lenovo\.gemini\antigravity\brain\ae604c30-8b55-4422-afde-bda205c4dced\bundle_for_ai_studio"

party_files = [
    ("01 Home", os.path.join(bundle_dir, "party_mode_01_home.png")),
    ("02 Library", os.path.join(bundle_dir, "party_mode_02_library.png")),
    ("03 Tournament", os.path.join(bundle_dir, "party_mode_03_tournament.png")),
    ("04 Winner / Podium", os.path.join(bundle_dir, "party_mode_04_winner.png")),
    ("05 Settings (Appearance)", os.path.join(bundle_dir, "party_mode_05_settings.png")),
]

normal_files = [
    ("01 Home", os.path.join(bundle_dir, "normal_mode_01_home.png")),
    ("02 Library", os.path.join(bundle_dir, "normal_mode_02_library.png")),
    ("03 Tournament", os.path.join(bundle_dir, "normal_mode_03_tournament.png")),
    ("04 Winner / Podium", os.path.join(bundle_dir, "normal_mode_04_winner.png")),
    ("05 Settings (Appearance)", os.path.join(bundle_dir, "normal_mode_05_settings.png")),
]

thumb_w, thumb_h = 680, 410
pad = 20
header_h = 40

grid_w = thumb_w * 3 + pad * 4
grid_h = (thumb_h + header_h) * 2 + pad * 3

positions = [
    (pad, pad),
    (pad * 2 + thumb_w, pad),
    (pad * 3 + thumb_w * 2, pad),
    (pad + thumb_w // 2, pad * 2 + thumb_h + header_h),
    (pad * 2 + thumb_w + thumb_w // 2, pad * 2 + thumb_h + header_h),
]

def make_overview(file_list, title_prefix, color, out_filename):
    collage = Image.new("RGB", (grid_w, grid_h), (18, 16, 22))
    draw = ImageDraw.Draw(collage)
    for (label, filepath), (x, y) in zip(file_list, positions):
        if os.path.exists(filepath):
            img = Image.open(filepath).convert("RGB")
            img_resized = img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            draw.text((x + 10, y + 8), f"{title_prefix} - {label}", fill=color)
            collage.paste(img_resized, (x, y + header_h))
    
    local_path = os.path.join(bundle_dir, out_filename)
    artifact_path = os.path.join(artifact_dir, out_filename)
    collage.save(local_path, "PNG", quality=95)
    collage.save(artifact_path, "PNG", quality=95)
    print(f"Created {local_path} and {artifact_path}")

make_overview(party_files, "Party Mode (Game Show)", (245, 158, 11), "bundle_party_mode_overview.png")
make_overview(normal_files, "Normal Mode (Material Dark)", (56, 189, 248), "bundle_normal_mode_overview.png")
