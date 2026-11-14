import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
html = open("data/raw/reviewers/antdroid/reviews/2020_07_hidition-viento-b-custom-in-ear-monitor.html", encoding="utf-8").read()

# let's look for Overall or Conclusion heading
text = re.sub(r'<[^>]+>', ' ', html)
text = ' '.join(text.split())

for heading in ["Overall", "Final Thoughts", "Summary"]:
    pos = text.find(heading)
    if pos != -1:
        print(f"=== {heading} ===")
        print(text[pos:pos+600])
        print()

