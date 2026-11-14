import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
html = open("data/raw/reviewers/crinacle/rankings.html", encoding="utf-8").read()
matches = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
for m in matches:
    if "hidition" in m.lower():
        text = re.sub(r'<[^>]+>', ' | ', m)
        print(' '.join(text.split()))

