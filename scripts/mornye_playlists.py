"""Read Mornye's playlists and match their songs to our library, so both apps show the same lists.

Works on a temporary copy of Mornye's database, so Mornye itself is never touched, even while it's running.
Matching, best first: ISRC; then title and artist; then title and length within 2 seconds.

Usage: python scripts/mornye_playlists.py     (prints what matched and what didn't)
"""
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def source_dir():
    return os.path.join(os.environ.get('APPDATA', ''), 'zarz', 'Mornye')


def norm(text):
    text = unicodedata.normalize('NFKC', text or '').lower()
    text = re.sub(r'[\(\[].*?[\)\]]', ' ', text)
    text = re.sub(r'\b(feat|ft|featuring)\b.*', ' ', text)
    return re.sub(r'[^\w]+', ' ', text).strip()


def first_artist(text):
    return norm(re.split(r',|&|;|/| x | and ', text or '')[0])


def read_playlists():
    """[(id, name, [track dicts in Mornye's order])], or [] if Mornye isn't installed."""
    src = source_dir()
    if not os.path.exists(os.path.join(src, 'library_collections.db')):
        return []
    with tempfile.TemporaryDirectory() as tmp:
        for name in os.listdir(src):
            if name.startswith('library_collections.db'):
                shutil.copy2(os.path.join(src, name), tmp)
        con = sqlite3.connect(os.path.join(tmp, 'library_collections.db'))
        try:
            out = []
            for pid, name in con.execute('select id, name from playlists order by created_at').fetchall():
                rows = con.execute('select track_json from playlist_tracks where playlist_id = ? order by added_at, rowid', (pid,)).fetchall()
                out.append((pid, name, [json.loads(r[0]) for r in rows]))
            return out
        finally:
            con.close()


def match_tracks(wanted, tracks):
    """Our track for each Mornye one, in order: returns (ids, misses)."""
    by_isrc = {}
    by_pair = {}
    by_title = {}
    for t in tracks:
        if t.get('isrc'):
            by_isrc.setdefault(t['isrc'].replace('-', '').upper(), t)
        by_pair.setdefault((norm(t['title']), first_artist(t['artist'])), []).append(t)
        by_title.setdefault(norm(t['title']), []).append(t)
    ids = []
    misses = []
    seen = set()
    for w in wanted:
        title = w.get('name', '')
        artist = w.get('artistName', '')
        seconds = (w.get('duration') or 0)
        if seconds > 3000:
            seconds /= 1000  # some entries hold milliseconds
        isrc = (w.get('isrc') or '').replace('-', '').upper()
        found = by_isrc.get(isrc) if isrc else None
        if not found:
            same = by_pair.get((norm(title), first_artist(artist)), [])
            found = min(same, key=lambda t: abs(t['sec'] - seconds)) if same else None
        if not found and seconds:
            near = [t for t in by_title.get(norm(title), []) if abs(t['sec'] - seconds) <= 2]
            found = near[0] if len(near) == 1 else None
        if found and found['id'] not in seen:
            seen.add(found['id'])
            ids.append(found['id'])
        elif not found:
            misses.append(f'{title} - {artist}')
    return ids, misses


def as_fixture(tracks):
    """Playlists in the fixture's format, plus what couldn't be matched."""
    playlists = []
    misses = {}
    for pid, name, wanted in read_playlists():
        ids, missed = match_tracks(wanted, tracks)
        playlists.append(dict(id=pid, name=name, tracks=ids))
        if missed:
            misses[name] = missed
    return playlists, misses


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    with open(os.path.join(ROOT, 'app', 'shell-fixture', 'library.json'), encoding='utf-8') as f:
        lib = json.load(f)
    wanted = read_playlists()
    print('Mornye:', [(n, len(w)) for _, n, w in wanted])
    if wanted:
        print('sample fields:', sorted(wanted[0][2][0].keys())[:30])
    playlists, misses = as_fixture(lib['tracks'])
    print('Matched:', [(p['name'], len(p['tracks'])) for p in playlists])
    for name, missed in misses.items():
        print(name, 'unmatched', len(missed))
        for m in missed[:40]:
            print('  ', m)
