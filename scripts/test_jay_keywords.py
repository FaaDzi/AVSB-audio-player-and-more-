"""Checks keyword extraction against sentences from Jay's notes (verified by hand).

Usage: python -I scripts/test_jay_keywords.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jay_keywords import extract  # noqa: E402
from names import jay_keys, key  # noqa: E402


def tags(notes, group):
    return {k["tag"] for k in extract(notes)[group]}


CASES = [
    # (notes, group, must include, must exclude)
    ("Not for bassy libraries like hiphop, and can be a bit energetic on kpop/jpop/rock stuff with a lot of treble.",
     "signature", set(), {"bassy"}),
    ("Not for bassy libraries like hiphop, and can be a bit energetic on kpop/jpop/rock stuff with a lot of treble.",
     "notFor", {"hip-hop"}, set()),
    ("Doesn't scale well, a mid-volume set that excels with certain genres like indie, acoustics, ballads, r&b, and slower pop stuff.",
     "strengths", set(), {"scales with volume"}),
    ("Doesn't scale well, a mid-volume set that excels with certain genres like indie, acoustics, ballads, r&b, and slower pop stuff.",
     "goodFor", {"indie", "acoustic", "ballads", "r&b"}, set()),
    ("Mid-bass is lacking and would not recommend for rock or hiphop.", "notFor", {"rock", "hip-hop"}, set()),
    ("Mid-bass is lacking and would not recommend for rock or hiphop.", "goodFor", set(), {"rock", "hip-hop"}),
    ("Very clean, no sharpness, or sudden peaks, endgame separation and detail.", "weaknesses", set(), {"sharp/harsh treble"}),
    ("punches way above its price point tech wise", "strengths", set(), {"bass texture/slam"}),
    ("Fast and clean bass but still rumbly and punchy.", "strengths", {"bass texture/slam"}, set()),
    ("Great for rock/metal, scales decently high.", "goodFor", {"rock", "metal"}, set()),
    ("Clean, clear, neutral-vocal leaning tuning with basically no low-end.", "signature", {"neutral", "lean"}, set()),
]


def main():
    failed = 0
    for notes, group, must, mustnt in CASES:
        got = tags(notes, group)
        if not must <= got or got & mustnt:
            failed += 1
            print(f"FAIL [{group}] {notes[:70]}...\n  got {sorted(got)}, need {sorted(must)}, forbid {sorted(mustnt)}")
    # name keys
    assert key("Thieaudio Monarch MKII") == key("ThieAudio Monarch MK2")
    assert key("LETSHUOER Cadenza 12") == key("Shuoer Cadenza 12")
    assert key("Thieaudio Monarch MK2") != key("Thieaudio Monarch MK3")
    assert key("7hertz Sonus") in jay_keys("7Hz Sonus -50 lowest") or key("7hz Sonus") in jay_keys("7hertz Sonus -50 lowest")
    print(f"{len(CASES) - failed}/{len(CASES)} keyword cases passed; name keys ok")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
