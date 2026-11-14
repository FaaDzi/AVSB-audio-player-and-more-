"""Antdroid's IEM Ranking List (published Google Sheet on audiodiscourse.com) + quotes from the linked
Audio Discourse reviews -> data/reviewers/antdroid.json

The sheet has grades but no comments, so the quote comes from the linked review's closing section
("Final Thoughts", "Conclusion", ...): the first sentences there that name the model, else the first
substantial closing paragraph.
"""
import html, json, re, sys, urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from resolve import resolve, clip, ROOT

RAW = ROOT / "data/raw/reviewers/antdroid"
SRC = "https://www.audiodiscourse.com/p/antdroid-iem-ranking-list.html"
CLOSING = re.compile(r"^(final thoughts?|conclusions?|in conclusion|summary|verdict|closing thoughts?|wrap[- ]?up|"
                     r"final words?|overall( thoughts| impressions)?|the verdict|bottom line|final verdict|recap)\b[:.!]?",
                     re.I)
STOP = re.compile(r"^(--|view the product ratings|disclaimer|related|share this|labels:)", re.I)


def paragraphs(path):
    s = path.read_text(encoding="utf-8", errors="replace")
    i = max(s.find("class='post-body"), s.find('class="post-body'))
    j = s.find("post-footer", i)
    if i < 0:
        return []
    b = re.sub(r"<script.*?</script>|<style.*?</style>", " ", s[i:j], flags=re.S)
    b = re.sub(r"<(br|/p|/div|/h\d|/li|/tr)[^>]*>", "\n", b, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", b))
    lines = [re.sub(r"\s+", " ", x).strip() for x in t.split("\n") if x.strip()]
    # older posts hard-wrap sentences with <br>: re-join a line onto the previous one when the
    # previous line does not end a sentence and this one continues it
    out = []
    for x in lines:
        if out and not re.search(r"[.!?:\"”)]$", out[-1]) and len(out[-1]) > 40 and re.match(r"[a-z0-9,(’'$]", x):
            out[-1] += " " + x
        else:
            out.append(x)
    return out


def model_tokens(name):
    toks = [t for t in re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", re.sub(r"\(.*?\)", "", name))]
    return [t for t in toks[1:] if t.lower() not in {"audio", "acoustics", "ears", "mk2", "mkii", "pro", "edition"}] or toks


def sentences(p):
    return [x for x in re.split(r"(?<=[.!?])\s+(?=[A-Z\"'(])", p) if x]


def pick_quote(paras, name):
    toks = [t.lower() for t in model_tokens(name)]
    start = None
    for k, p in enumerate(paras):
        if len(p) < 40 and CLOSING.match(p):
            start = k + 1
    body = []
    for p in paras[start:] if start is not None else []:
        if STOP.match(p):
            break
        if len(p) >= 60 and not p.endswith("?"):
            body.append(p)
    if not body:
        return None, False
    for p in body:  # first sentence run that names the model
        ss = sentences(p)
        for n, s in enumerate(ss):
            if any(t in s.lower() for t in toks):
                q = s
                for nxt in ss[n + 1:]:
                    if len(q) + 1 + len(nxt) > 300:
                        break
                    q += " " + nxt
                return clip(q), True
    return clip(body[0]), True


rows = json.loads((RAW / "rows.json").read_text(encoding="utf-8"))
entries, missing = [], []
for r in rows:
    if not r["link"]:
        missing.append((r["name"], "no review link in sheet"))
        continue
    path = RAW / "reviews" / urllib.parse.urlparse(r["link"]).path.strip("/").replace("/", "_")
    if not path.exists() or path.stat().st_size < 5000:
        missing.append((r["name"], "review page not fetched"))
        continue
    quote, _ = pick_quote(paragraphs(path), r["name"])
    if not quote:
        missing.append((r["name"], "no closing section found"))
        continue
    name, conf, _ = resolve(r["name"])
    verdict = (f"Antdroid grades it {r['grade']} overall (score {r['score']}/20; tonality {r['tonality']}, "
               f"technicalities {r['tech']}, preference {r['pref']}).")
    entries.append({"name": name, "rawName": r["name"], "nameConfidence": conf, "grade": r["grade"],
                    "verdict": verdict, "quote": quote, "quoteVerified": False, "url": r["link"]})

out = {"reviewer": "Antdroid", "sourceType": "ranking-list", "sourceUrl": SRC, "accessed": "2026-10-16",
       "gradeScale": "Letter grades S+ (20) down to F- (0) mapped to a 20-point score; overall = weighted tonality (15%), technicalities (15%) and personal preference (70%). Sheet last updated May 27, 2024; quotes come from each linked review's closing section.",
       "entries": entries}
(ROOT / "data/reviewers/antdroid.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
(RAW / "skipped.json").write_text(json.dumps(missing, indent=1, ensure_ascii=False), encoding="utf-8")
print(len(entries), "entries;", len(missing), "skipped")
