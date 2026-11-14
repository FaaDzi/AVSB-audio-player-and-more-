import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
html = open("data/raw/reviewers/antdroid/reviews/2020_07_hidition-viento-b-custom-in-ear-monitor.html", encoding="utf-8").read()

for marker in ["On where it excels:", "On whether this was worth the time and wait:", "Final words:"]:
    pos = html.find(marker)
    if pos != -1:
        snippet = html[pos:pos+500]
        clean_s = re.sub(r'<[^>]+>', ' ', snippet)
        clean_s = ' '.join(clean_s.split())
        print(f"=== {marker} ===")
        print(clean_s)
        print()

