"""Rule-based keyword extraction from Jay Audio's (@jayyaudio) ranking notes.

Only phrases that literally appear in his notes produce a keyword, so nothing is invented.
Each keyword keeps the sentence it came from as evidence.
"""
import re

# label: regex (matched case-insensitively against one sentence)
SIGNATURE = {
    "bassy": r"\bbass(y|head)\b|bass[- ]boost|sub-bass boost|lots of bass|bass-heavy",
    "warm": r"\bwarm",
    "bright": r"\bbright|treble emphasis|treble boost|treblehead",
    "neutral": r"\bneutral",
    "balanced": r"\bbalanced",
    "v-shaped": r"\bv[- /]?shape",
    "u-shaped": r"\bu[- ]?shape",
    "harman": r"\bharman",
    "diffuse-field": r"diffuse ?field",
    "mid-centric": r"mid-?range (centric|focused)|mids? (centric|focused)|vocal[- ](centric|focused|forward)|forward vocals",
    "dark": r"\bdark(er)?\b",
    "lean": r"\blean\b|bass-light|no low-end|lacks? (sub-)?bass",
}
STRENGTHS = {
    "great vocals": r"(best|great|good|solid|beautiful|amazing|sweet|clean|clear|natural|top tier|totl) (female |male )?vocals|vocal benchmark",
    "airy treble": r"\bairy|treble air|\bair\b",
    "smooth": r"\bsmooth",
    "detailed": r"\bdetail|resolution|resolving|micro-?details",
    "technical": r"\btech(nical)?\b|totl tech|technical monster",
    "wide/3D stage": r"(wide|open|big|huge|3d|holographic|expansive|immersive)[a-z ,/]*stag|holographic|3d",
    "imaging": r"imaging",
    "separation/layering": r"separat|seperat|layering",
    "bass texture/slam": r"bass texture|low-end texture|slam|\bpunchy|\bpunch\b(?! above| way)|rumbl|impact",
    "natural timbre": r"natural|timbre",
    "dynamic/engaging": r"\bdynamic|engaging|\bfun\b",
    "all-rounder": r"all-?rounder",
    "scales with volume": r"scales? (great|well|beautifully|decently|better)",
}
WEAKNESSES = {
    "can be fatiguing": r"fatigu",
    "sharp/harsh treble": r"\bsharp|harsh|peaky|spicy|hot\b|sizzl",
    "sibilant": r"sibilan",
    "shouty upper mids": r"shouty",
    "thin": r"\bthin\b",
    "dry": r"\bdry\b",
    "recessed mids/vocals": r"recessed|pulled back|laid back|mid-?scoop|vocals are gone|buried",
    "bloated/congested": r"bloat|congest|bleed",
    "lacks sub-bass": r"(more|lack(s|ing)?|meh)[a-z ]*sub-?bass|sub-?bass is a bit meh",
    "lacks mid-bass": r"mid-?bass (is )?(lacking|tuck)|lack(s|ing)? mid-?bass|those who want mid-bass",
    "soft transients": r"soft (notes|transients)|transients (can be|are) (a bit )?soft|better transients",
    "small stage": r"(small|close|intimate)[a-z ]*stag|stage is (very )?close",
    "fit issues": r"\bfit (issue|may be|is)|fit issues",
    "overpriced": r"overpriced|premium tax|costs way too much",
    "unit variance": r"unit variance|my unit|graphs? (very )?different|sound different",
}
GENRES = {
    "rock": r"\brock\b|bands?\b",
    "metal": r"\bmetal\b",
    "hip-hop": r"hip-?hop|\brap\b",
    "k-pop/j-pop": r"k-?pop|j-?pop",
    "edm": r"\bedm\b|electronic",
    "pop": r"(?<![kj]-)(?<![kj])\bpop\b",
    "ballads": r"ballads?",
    "acoustic": r"acoustic",
    "indie": r"\bindie\b",
    "r&b": r"r&b",
    "classical": r"classical|orchestra",
    "instrumentals": r"instrumental",
    "gaming": r"gaming",
}
# Cues that set the polarity of the genres that follow them in a sentence.
POSITIVE_CUES = r"good (for|on)|great for|excels|recommended (for|library)|\brec(ommend)? (for|on)|sounds (very )?good on|shines|immersive set for|best for|perfect for|works (well|great)|adds more energy"
NEGATIVE_CUES = r"\bnot (for|rec|recommended)|don'?t rec|wouldn'?t|would not|avoid|forget|too much on|fatiguing|sharp on|spicy (with|on)|could use more|not a\b|lacking|can get|isn'?t (good|great) (for|on)"
# Words just before a match that flip it ("not a bassy set", "no sharpness").
LOCAL_NEGATION = r"(\bnot( a| as| very| that)?|\bno|n't|\bless|\bwithout|\black(s|ing)?( of)?|could use (more|better)|would'?ve liked( more)?|\bfor) *[a-z-]* *$"
# Weakness labels whose own wording is negative, so the local-negation check must not apply.
NEG_EXEMPT = {"lacks sub-bass", "lacks mid-bass", "recessed mids/vocals", "soft transients", "small stage"}
VOLUME = {"high": r"high[- ]volume|blast|cranked|higher volumes?", "low/mid": r"lower to mid volume|mid-volume set|lower[- ]volume"}


def sentences(text: str):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\s+-\s+", text) if s.strip()]


def negated_locally(low: str, start: int) -> bool:
    return re.search(LOCAL_NEGATION, low[max(0, start - 28):start]) is not None


def genre_polarity(low: str):
    """(genre, polarity) for each genre mention, using the nearest preceding cue."""
    neg = [m.start() for m in re.finditer(NEGATIVE_CUES, low)]
    # "would not recommend for": a positive cue right after a negative one belongs to it
    pos = [m.start() for m in re.finditer(POSITIVE_CUES, low) if not any(0 <= m.start() - n <= 20 for n in neg)]
    cues = [(i, "goodFor") for i in pos] + [(i, "notFor") for i in neg]
    for label, rx in GENRES.items():
        for m in re.finditer(rx, low):
            before = [c for c in cues if c[0] < m.start()]
            if before:
                yield label, max(before)[1]
                break


def extract(notes: str) -> dict:
    out = {"signature": {}, "strengths": {}, "weaknesses": {}, "goodFor": {}, "notFor": {}}
    for s in sentences(notes):
        low = s.lower()
        for group, table in (("signature", SIGNATURE), ("strengths", STRENGTHS), ("weaknesses", WEAKNESSES)):
            for label, rx in table.items():
                if label in out[group]:
                    continue
                for m in re.finditer(rx, low):
                    if label in NEG_EXEMPT or not negated_locally(low, m.start()):
                        out[group][label] = s
                        break
        for label, bucket in genre_polarity(low):
            out[bucket].setdefault(label, s)
    for label in list(out["goodFor"]):
        if label in out["notFor"] and out["goodFor"][label] == out["notFor"][label]:
            del out["goodFor"][label]
    return {k: [{"tag": t, "evidence": e} for t, e in v.items()] for k, v in out.items()}
