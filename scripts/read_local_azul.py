import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
html = open("data/raw/reviewers/antdroid/reviews/2021_04_prisma-azul-review.html", encoding="utf-8").read()

imgs = re.findall(r'<img[^>]+src="([^">]+)"', html)
print("Images found:", len(imgs))
for im in imgs:
    if "blogger" in im or "googleusercontent" in im or "blogspot" in im:
        print("  IMG:", im)

text = re.sub(r'<[^>]+>', ' ', html)
text = ' '.join(text.split())
pos = text.lower().find("overall")
if pos != -1:
    print("\nOVERALL:\n", text[pos:pos+500])

