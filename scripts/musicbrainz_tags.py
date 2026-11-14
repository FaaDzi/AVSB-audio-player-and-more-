"""Look up every song in songs/manifest.json (those with a file) on MusicBrainz.

For each song: search the recording by artist + title, take the best-scoring match, then
read its genres/tags, its artist's genres/tags, and the earliest release (year, album).

Polite: one request per second with a descriptive User-Agent (MusicBrainz rules).
Resumable: raw responses are cached in data/raw/musicbrainz/.
Output: data/song_tags.json (song id -> match + genres/tags), plus a summary on stdout.

Usage: python -I scripts/musicbrainz_tags.py
"""
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "musicbrainz"
OUT = ROOT / "data" / "song_tags.json"
API = "https://musicbrainz.org/ws/2/"
UA = "IEMDreamBracket/0.1 (personal song-tagging script)"
MIN_SCORE = 80  # MusicBrainz search score (0-100) below which we don't trust the match

_last = [0.0]


def get(path, params):
    url = API + path + "?" + urllib.parse.urlencode({**params, "fmt": "json"})
    key = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    for attempt in range(4):
        wait = 1.1 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8"))
            key.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as e:  # 503 = rate limited; back off and retry
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    return None


def lucene(s):
    return re.sub(r'([+\-&|!(){}\[\]^"~*?:\\/])', r"\\\1", s)


def main_artist(a):
    # "Kurousa-P feat. Hatsune Miku" -> "Kurousa-P"; "Avicii & Sandro Cavazza" -> "Avicii"
    a = re.sub(r"\s*\((cv|cover)[^)]*\)", "", a, flags=re.I)  # "Hanasaka Yui (CV: M·A·O)" -> "Hanasaka Yui"
    return re.split(r"\s+(?:feat\.|ft\.|vs\.?|&|\+|x)\s+", a, flags=re.I)[0].strip()


def clean_title(t):
    return re.sub(r"\s*\((live|movie ver\.|remix|vip|cover)[^)]*\)", "", t, flags=re.I).strip()


def tag_names(obj, key):
    return [{"name": t["name"], "count": t.get("count", 0)} for t in (obj or {}).get(key, []) if t.get("count", 0) >= 0]


def find_artist(name):
    """Best artist for a name; MusicBrainz also searches aliases (romanised Japanese names etc.)."""
    if not name:
        return None
    res = get("artist", {"query": f'artist:"{lucene(name)}" OR alias:"{lucene(name)}"', "limit": 5}) or {}
    arts = [a for a in res.get("artists", []) if int(a.get("score", 0)) >= 90]
    return arts[0] if arts else None


def lookup(song):
    """Artist first, then that artist's recording, so covers and same-titled songs can't match."""
    artist, title = main_artist(song["artist"]), clean_title(song["title"])
    art = find_artist(artist)
    if not art:
        return {"match": None, "reason": "artist not found"}
    q = f'recording:"{lucene(title)}" AND arid:{art["id"]}'
    recs = (get("recording", {"query": q, "limit": 10}) or {}).get("recordings", [])
    if not recs:
        recs = (get("recording", {"query": f"{lucene(title)} AND arid:{art['id']}", "limit": 10}) or {}).get("recordings", [])
    recs = [r for r in recs if int(r.get("score", 0)) >= MIN_SCORE]
    artist_info = get(f"artist/{art['id']}", {"inc": "genres+tags"}) or {}
    base = {
        "artist_match": {"mbid": art["id"], "name": art.get("name")},
        "artist_genres": tag_names(artist_info, "genres"),
        "artist_tags": tag_names(artist_info, "tags"),
    }
    if not recs:  # recording not listed: the artist's genres are still useful
        return {"match": None, "reason": "recording not found", **base}
    best = max(recs, key=lambda r: (int(r.get("score", 0)), len(r.get("releases", []))))
    rec = get(f"recording/{best['id']}", {"inc": "genres+tags+artist-credits+releases"}) or {}
    releases = sorted((r for r in rec.get("releases", []) if r.get("date")), key=lambda r: r["date"])
    first = releases[0] if releases else {}
    return {
        "match": {"mbid": best["id"], "title": rec.get("title", best.get("title")), "artist": art.get("name"), "score": int(best.get("score", 0))},
        "year": int(first["date"][:4]) if first.get("date", "")[:4].isdigit() else None,
        "album": first.get("title"),
        "genres": tag_names(rec, "genres"),
        "tags": tag_names(rec, "tags"),
        **base,
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    CACHE.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "songs" / "manifest.json").read_text(encoding="utf-8"))
    songs = [s for s in manifest["songs"] if s.get("fileName")]
    out = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for i, s in enumerate(songs, 1):
        if s["id"] in out:
            continue
        r = lookup(s)
        out[s["id"]] = {"query": f'{s["artist"]} - {s["title"]}', **r}
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        m = r.get("match")
        tags = [t["name"] for t in (r.get("genres") or r.get("artist_genres") or [])][:4]
        print(f"{i}/{len(songs)} {s['artist']} - {s['title']}: " + (f"{m['artist']} - {m['title']} ({m['score']}) {tags}" if m else f"{r.get('reason')} {tags}"), flush=True)
    matched = sum(1 for v in out.values() if v.get("match"))
    tagged = sum(1 for v in out.values() if v.get("genres") or v.get("tags") or v.get("artist_genres") or v.get("artist_tags"))
    print(f"done: {matched}/{len(out)} matched, {tagged} with any genre/tag")


if __name__ == "__main__":
    main()
