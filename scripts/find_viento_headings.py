import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
html = open("data/raw/reviewers/antdroid/reviews/2020_07_hidition-viento-b-custom-in-ear-monitor.html", encoding="utf-8").read()

headings = re.findall(r'<h[1-4][^>]*>(.*?)</h[1-4]>', html, re.I)
for h in headings:
    print("H:", re.sub(r'<[^>]+>', '', h).strip())
bolds = re.findall(r'<b>(.*?)</b>', html)
for b in bolds[:15]:
    clean_b = re.sub(r'<[^>]+>', '', b).strip()
    if len(clean_b) > 2:
        print("B:", clean_b)

