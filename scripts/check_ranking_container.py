import re
from pathlib import Path

html = Path("data/raw/resolve_rankings.html").read_text(encoding="utf-8")
pos = html.find('ranking-table-container')
if pos != -1:
    print("Found ranking-table-container at", pos)
    print("Surrounding 1500 chars:\n", html[pos-200:pos+1500])

