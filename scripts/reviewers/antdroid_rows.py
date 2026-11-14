"""Parse Antdroid's published Score Sheet HTML -> rows with review links. Writes data/raw/reviewers/antdroid/rows.json"""
import re, html, json, sys, urllib.parse, pathlib
R = pathlib.Path("data/raw/reviewers/antdroid")
s = (R / "score_sheet.html").read_text(encoding="utf8")
rows = []
for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S):
    tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
    cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in tds]
    if len(cells) < 11 or cells[0] != "Link":
        continue
    m = re.search(r'href="([^"]+)"', tds[0])
    link = None
    if m:
        u = html.unescape(m.group(1))
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get("q")
        link = q[0] if q else u
    rows.append(dict(link=link, name=cells[1], price=cells[2], score=cells[4], grade=cells[5],
                     tonality=cells[7], tech=cells[8], pref=cells[9], source=cells[11] if len(cells) > 11 else ""))
(R / "rows.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf8")
links = [r["link"] for r in rows if r["link"]]
print(len(rows), "rows;", len(links), "with link;", len(set(links)), "unique")
from collections import Counter
print(Counter(urllib.parse.urlparse(l).netloc for l in links))
