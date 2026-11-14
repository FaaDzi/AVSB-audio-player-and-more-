"""Precogvision's IEM rankings (iemmarkettracker.com/rankings.html, linked as "Rankings" from precog.squig.link)
-> data/reviewers/precogvision.json"""
import re, html, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from resolve import resolve, clip, ROOT

SRC = "https://iemmarkettracker.com/rankings.html"
raw = (ROOT / "data/raw/reviewers/precogvision/rankings.html").read_text(encoding="utf-8")


def text(c):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip()


entries = []
for m in re.finditer(r'<tr class="ranking-row[^"]*"(.*?)>(.*?)</tr>', raw, re.S):
    attrs, body = m.group(1), m.group(2)
    a = dict(re.findall(r'data-([\w-]+)="([^"]*)"', attrs))
    tds = re.findall(r"<td[^>]*>(.*?)</td>", body, re.S)
    cells = [text(t) for t in tds]
    comment, based_on = cells[-2], cells[-1]
    if not comment or comment in ("—", "-"):
        continue
    rawname = html.unescape(a["iem"])
    ranked = a.get("entry-type") == "ranked"
    tonality, tech, bias = cells[3], cells[7], cells[11]
    link = re.search(r'href="([^"]+\.html)\?from=rankings"', tds[1])
    name, conf, _ = resolve(rawname)
    if ranked:
        grade = f"{a['score']}/10"
        verdict = (f"Precogvision gives it a final score of {a['score']}/10 "
                   f"(tonality {tonality}, technicalities {tech}, personal bias {bias}), "
                   f"based on a {based_on.lower()}.")
    else:
        grade = None
        verdict = f"Precogvision lists it as a brief demo impression without a formal score (bias {bias})."
    entries.append({
        "name": name, "rawName": rawname, "nameConfidence": conf, "grade": grade, "verdict": verdict,
        "quote": clip(html.unescape(comment)), "quoteVerified": False,
        "url": SRC,
    })

out = {
    "reviewer": "Precogvision", "sourceType": "ranking-list", "sourceUrl": SRC, "accessed": "2026-10-16",
    "gradeScale": "Final Score out of 10 built from Tonality, Technicalities (detail/imaging/dynamics) and a personal Bias score; 'demoed' entries are brief impressions with no formal score.",
    "entries": entries,
}
p = ROOT / "data/reviewers/precogvision.json"
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print(len(entries), "entries")
