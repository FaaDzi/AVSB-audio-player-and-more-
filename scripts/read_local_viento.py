import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
path = "data/raw/reviewers/antdroid/reviews/2020_07_hidition-viento-b-custom-in-ear-monitor.html"
html = open(path, encoding="utf-8").read()

imgs = re.findall(r'<img[^>]+src="([^">]+)"', html)
print("Images found:", len(imgs))
for im in imgs:
    if "blogger" in im or "googleusercontent" in im or "blogspot" in im:
        print("  ", im)

text = re.sub(r'<[^>]+>', ' ', html)
text = ' '.join(text.split())
pos = text.lower().find("conclusion")
if pos != -1:
    print("\nCONCLUSION:\n", text[pos:pos+500])
else:
    print("SNIPPET:", text[:500])

