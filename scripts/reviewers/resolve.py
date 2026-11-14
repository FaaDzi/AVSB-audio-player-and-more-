"""Resolve reviewer-written IEM names to catalog names in app/public/data/iems.json.

resolve(raw) -> (name, confidence, in_catalog)
  high   : same key as a catalog name, or same base model (parenthesised tip/switch/module
           variants on either side ignored) with only one base model among the candidates
  medium : spelling-only difference (edit distance 1-2, same numbers, not a longer/shorter model name)
  low    : plausible fuzzy guess (ratio >= 0.85, same numbers, in_catalog=False) or the raw name itself
"""
import json, re, sys, difflib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from names import key, base  # noqa: E402

CATALOG = [i["name"] for i in json.load(open(ROOT / "app/public/data/iems.json", encoding="utf-8"))["iems"]]
BY_KEY, BY_BASE = {}, {}
EXTRA = [  # spelling differences seen in these sources
    (r"\bfiio\b", "fiio"), (r"\btin ?hifi\b", "tinhifi"), (r"\bthie ?audio\b", "thieaudio"),
    (r"\bdunu[- ]topsound\b", "dunu"), (r"\belysian acoustic labs?\b", "elysian"), (r"\bunique melody\b", "um"),
    (r"\bsymphonium audio\b", "symphonium"), (r"\bfir audio\b", "fir"), (r"\bcampfire audio\b", "campfire"),
    (r"\btruthears?\b", "truthear"), (r"\bcrinears?\b", "crinear"), (r"\bkinera\s+celest\b", "celest"),
    (r"\bjvc ha-?", "jvc "), (r"\bkiwi ?ears\b", "kiwiears"), (r"\bletshouer\b", "letshuoer"),
]


def _norm(s):
    s2 = s.lower()
    for rx, rep in EXTRA:
        s2 = re.sub(rx, rep, s2)
    return s2


def _k(s):
    return key(_norm(s))


def _tokens(s):
    return [t for t in re.split(r"[^a-z0-9]+", _norm(base(s))) if t]


def _spelling_only(a, b):
    """True when two names differ only by small misspellings inside long words."""
    ta, tb = _tokens(a), _tokens(b)
    if len(ta) != len(tb):
        return False
    for x, y in zip(ta, tb):
        if x != y and not (len(x) >= 6 and len(y) >= 6 and re.findall(r"\d+", x) == re.findall(r"\d+", y)
                           and _lev(x, y) <= 2):
            return False
    return True


for n in CATALOG:
    BY_KEY.setdefault(_k(n), []).append(n)
    BY_BASE.setdefault(_k(base(n)), []).append(n)
ALL_KEYS = list(BY_KEY)


def _pick(cands, raw=""):
    # prefer a candidate carrying the raw name's own variant, e.g. "(M15)" -> "(m15 Apex module)";
    # otherwise the plain model (no parenthesised variant), then the shortest name
    var = [key(v) for v in re.findall(r"\((.*?)\)", raw)]
    def has_var(n):
        inner = " ".join(re.findall(r"\((.*?)\)", n))
        return any(v and re.search(r"(?<![a-z0-9])" + re.escape(v) + r"(?![0-9])", key(inner) + " " + inner.lower()) for v in var)
    return sorted(set(cands), key=lambda n: (not has_var(n), "(" in n, len(n), n))[0]


def resolve(raw, brand_hint=None):
    raw = re.sub(r"\s+", " ", raw).strip()
    tries = [raw]
    if brand_hint and not _k(raw).startswith(_k(brand_hint)):
        tries.append(f"{brand_hint} {raw}")
    for t in tries:
        k = _k(t)
        if k in BY_KEY:
            return _pick(BY_KEY[k]), "high", True
    for t in tries:
        for k in (_k(base(t)), _k(t)):
            cands = BY_BASE.get(k, []) + BY_KEY.get(k, [])
            if cands and len({_k(base(c)) for c in cands}) == 1:
                return _pick(cands, raw), "high", True
    best, ratio, bk = None, 0.0, ""
    for t in tries:
        for k in {_k(t), _k(base(t))}:
            m = difflib.get_close_matches(k, ALL_KEYS, n=1, cutoff=0.75)
            if m:
                r = difflib.SequenceMatcher(None, k, m[0]).ratio()
                if r > ratio:
                    best, ratio, bk = m[0], r, k
    if not best:
        return raw, "low", False
    same_digits = re.findall(r"\d+", bk) == re.findall(r"\d+", best)
    pick = _pick(BY_KEY[best])
    if same_digits and _spelling_only(raw, pick):
        return pick, "medium", True  # spelling difference only
    if same_digits and ratio >= 0.85:  # plausible guess, unconfirmed
        return _pick(BY_KEY[best]), "low", False
    return raw, "low", False


def _lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def clip(q, n=300):
    """Trim a quote to <= n chars, ending on a sentence boundary when possible."""
    if len(q) <= n:
        return q
    cut = q[:n]
    m = list(re.finditer(r"[.!?](\s|$)", cut))
    return cut[: m[-1].end()].strip() if m else cut.rsplit(" ", 1)[0]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for a in sys.argv[1:]:
        print(a, "->", resolve(a))
