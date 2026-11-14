# Sample data for the new shell (implementation_plan.md section 57): real tags and covers from songs/lossless.
# Output goes to app/shell-fixture (gitignored, outside public/, so only the new UI's exe build copies it).
#   python scripts/build_shell_fixture.py
import hashlib, io, json, os, re, sys
from multiprocessing import Pool

from mutagen import File as MutagenFile
from mutagen.flac import Picture
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'songs', 'lossless')
OUT = os.path.join(ROOT, 'app', 'shell-fixture')
COVERS = os.path.join(OUT, 'covers')
AUDIO = ('.flac', '.opus')
ISRC = re.compile(r'^[A-Z]{2}[A-Z0-9]{3}\d{7}$')


def first(tags, *keys):
    for k in keys:
        v = tags.get(k)
        if v and str(v[0]).strip():
            return str(v[0]).strip()
    return ''


def number(text):
    m = re.match(r'\s*(\d+)', text or '')
    return int(m.group(1)) if m else 0


def total(text):
    m = re.match(r'\s*\d+\s*/\s*(\d+)', text or '')
    return int(m.group(1)) if m else 0


def picture_of(audio):
    pics = getattr(audio, 'pictures', None)
    if pics:
        return pics[0].data
    for raw in (audio.tags or {}).get('metadata_block_picture', []) if audio.tags else []:
        import base64
        return Picture(base64.b64decode(raw)).data
    return None


def read(path):
    rel = os.path.relpath(path, LIB).replace('\\', '/')
    audio = MutagenFile(path)
    tags = {k.lower(): v for k, v in (audio.tags.as_dict().items() if hasattr(audio.tags, 'as_dict') else [])}
    info = audio.info
    stem = os.path.splitext(os.path.basename(path))[0]
    fmt = os.path.splitext(path)[1][1:].upper()
    pic = picture_of(audio)
    cover = ''
    if pic:
        cover = hashlib.md5(pic).hexdigest()[:16]
        target = os.path.join(COVERS, cover + '.webp')
        if not os.path.exists(target):
            im = Image.open(io.BytesIO(pic)).convert('RGB')
            im.thumbnail((640, 640))
            im.save(target, 'WEBP', quality=82, method=4)
    size = os.path.getsize(path)
    words = first(tags, 'lyrics', 'unsyncedlyrics')
    track_id = hashlib.md5(rel.encode()).hexdigest()[:12]
    if words:
        with open(os.path.join(OUT, 'lyrics', track_id + '.txt'), 'w', encoding='utf-8') as fh:
            fh.write(words)
    track = first(tags, 'tracknumber')
    disc = first(tags, 'discnumber')
    isrc = first(tags, 'isrc')
    date = first(tags, 'date', 'year')
    return dict(
        id=track_id,
        path=rel,
        folder=os.path.dirname(rel) or '.',
        title=first(tags, 'title') or stem,
        artist=first(tags, 'artist'),
        albumArtist=first(tags, 'albumartist', 'album artist'),
        album=first(tags, 'album'),
        track=number(track),
        trackTotal=total(track) or number(first(tags, 'tracktotal', 'totaltracks')),
        disc=number(disc),
        date=date,
        year=number(date) if number(date) > 999 else 0,
        genre=first(tags, 'genre'),
        label=first(tags, 'organization', 'label', 'publisher'),
        composer=first(tags, 'composer'),
        copyright=first(tags, 'copyright'),
        comment=first(tags, 'comment', 'description'),
        barcode=first(tags, 'barcode', 'upc'),
        releaseType=first(tags, 'releasetype', 'release type', 'musicbrainz_albumtype'),
        isrc=isrc,
        isrcOk=bool(ISRC.match(isrc.replace('-', '').upper())) if isrc else False,
        lyrics=bool(words),
        replayGain=bool(first(tags, 'replaygain_track_gain', 'r128_track_gain')),
        downloaded=bool(first(tags, 'service')) or getattr(audio.tags, 'vendor', '') == 'Mornye',
        format=fmt,
        lossy=fmt not in ('FLAC', 'ALAC', 'WAV', 'AIFF'),
        bits=getattr(info, 'bits_per_sample', 0) or 0,
        rate=getattr(info, 'sample_rate', 48000) or 48000,
        sec=round(info.length, 2),
        size=size,
        kbps=round((size - len(pic or b'')) * 8 / max(info.length, 1) / 1000),
        added=int(os.path.getmtime(path)),
        cover=cover,
    )


if __name__ == '__main__':
    os.makedirs(COVERS, exist_ok=True)
    os.makedirs(os.path.join(OUT, 'lyrics'), exist_ok=True)
    files = [os.path.join(d, f) for d, _, fs in os.walk(LIB) for f in fs if f.lower().endswith(AUDIO)]
    with Pool(10) as pool:
        tracks = pool.map(read, sorted(files))

    # the one real playlist: the app's song list, in its order
    by_path = {t['path']: t['id'] for t in tracks}
    audit = json.load(open(os.path.join(ROOT, 'research_notes', 'lossless_audit.json'), encoding='utf-8'))
    later = [by_path[e['file']] for e in audit['songs'] if e.get('file') in by_path]
    # the same playlists as Mornye when it's installed; otherwise the app's song list
    from mornye_playlists import as_fixture
    playlists, unmatched = as_fixture(tracks)
    for name, missed in unmatched.items():
        print(f'{name}: {len(missed)} songs not in the library')
    data = dict(tracks=tracks, playlists=playlists or [dict(id='later', name='Later', tracks=later)])
    with open(os.path.join(OUT, 'library.json'), 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))

    sys.stdout.reconfigure(encoding='utf-8')
    n = len(tracks)
    print(n, 'tracks;', len(later), 'in Later;', len(set(t['cover'] for t in tracks if t['cover'])), 'covers;', sum(not t['cover'] for t in tracks), 'without cover')
    for key in ('artist', 'albumArtist', 'album', 'year', 'genre', 'track', 'disc', 'isrc', 'label', 'lyrics', 'replayGain'):
        print(f'  missing {key}: {sum(not t[key] for t in tracks)}')
    print('  bad ISRC:', sum(1 for t in tracks if t['isrc'] and not t['isrcOk']), ' lossy:', sum(t['lossy'] for t in tracks), ' downloaded:', sum(t['downloaded'] for t in tracks))
