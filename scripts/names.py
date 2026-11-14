"""Shared IEM-name normalisation, so the same IEM written differently by different
sources ("LETSHUOER" / "Shuoer", "MKII" / "MK2", "ThieAudio" / "Thieaudio") gets one key.

Matching stays strict: model and version words must agree after normalisation.
"""
import re

ALIASES = [
    (r"\bshuoer\b", "letshuoer"),
    (r"\bsymphonium audio\b", "symphonium"),
    (r"\b7th acoustics\b", "7th acoustic"),
    (r"\bqueen of audio\b", "qoa"),
    (r"\bsimgot audio\b", "simgot"),
    (r"\bkiwiears\b", "kiwi ears"),
    (r"\b7 ?hertz\b", "7hz"),
    (r"\bbeyerdynamics\b", "beyerdynamic"),
    (r"\bmk ?iv\b", "mk4"),
    (r"\bmk ?iii\b", "mk3"),
    (r"\bmk ?ii\b", "mk2"),
    (r"\bmk ?i\b", "mk1"),
    (r"\bmark ?(\d)\b", r"mk\1"),
    (r"&", " and "),
]

# Words in Jay's sheet that describe his unit or the deal, not the model.
FILLER = (r"\b(og|old unit|new unit|2nd unit|\d{4} unit|unit|on sale|maybe at -?\d+|no-unit variance|retail"
          r"|outdated.*|lowest|normal rank|high[- ]vol(ume)?|mid[- ]vol(ume)?)(?=\s|$)|-?\d+ lowest")


def key(name: str) -> str:
    s = name.lower()
    for rx, rep in ALIASES:
        s = re.sub(rx, rep, s)
    return re.sub(r"[^a-z0-9]", "", s)


def base(name: str) -> str:
    """Name without parenthesised variants: 'Kato (gold nozzle)' -> 'Kato'."""
    return re.sub(r"\s*\(.*?\)", "", name).strip()


def jay_keys(name: str) -> list[str]:
    """Candidate keys for a name from Jay's sheet, strictest first."""
    cleaned = re.sub(FILLER, "", name, flags=re.I)
    return list(dict.fromkeys([key(name), key(cleaned)]))
