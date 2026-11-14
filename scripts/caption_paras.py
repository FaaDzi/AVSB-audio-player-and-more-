"""Print a de-duplicated caption .txt grouped into ~30 s paragraphs: [m:ss] text."""
import re, sys
sys.stdout.reconfigure(encoding="utf-8")
cur, start, last = [], None, 0
for ln in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"\[(\d+):(\d+)\] (.*)", ln.rstrip("\n"))
    t = int(m[1]) * 60 + int(m[2])
    if start is None: start = m[1] + ":" + m[2]; last = t
    if t - last >= 30 and cur:
        print(f"[{start}] " + " ".join(cur)); cur = []; start = m[1] + ":" + m[2]; last = t
    cur.append(m[3])
print(f"[{start}] " + " ".join(cur))
