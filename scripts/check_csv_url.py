from pathlib import Path

html = Path("data/raw/resolve_rankings.html").read_text(encoding="utf-8")
pos = html.find('function loadRankingData()')
if pos != -1:
    print(html[pos-1000:pos+200])

