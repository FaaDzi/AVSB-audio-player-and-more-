from pathlib import Path

img_dir = Path("app/public/img/iem")
matches = [f.name for f in img_dir.glob("*.webp") if any(k in f.name.lower() for k in ["subtonic", "storm", "myer", "slt6", "cklvx", "sliivo"])]
print("Matching images in app/public/img/iem:")
for m in matches:
    print(" ", m)

