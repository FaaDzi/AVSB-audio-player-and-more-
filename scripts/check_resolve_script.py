import re
from pathlib import Path

html = Path("data/raw/resolve_rankings.html").read_text(encoding="utf-8")
scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.S)
for s in scripts:
    if len(s) > 50000:
        print("Big script length:", len(s))
        print("First 1000 chars:\n", s[:1000])
        # Search for headphone names
        if "sennheiser" in s.lower():
            print("\nContains sennheiser! Searching for data structure...")
            m = re.findall(r'(\{[^{}]{10,200}sennheiser[^{}]{10,200}\})', s, re.I)
            if m:
                print("Sample object:", m[0])

