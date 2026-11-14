# Rewrites false FLACs in songs/lossless at the quality their samples really hold.
# Each result must pass its checks before it replaces the file; the original moves to "songs/Original nor converted".
#   python scripts/convert_false_flac.py <report.json> [--dry-run]
import hashlib, json, os, shutil, subprocess, sys
from multiprocessing import Pool

import numpy as np
from mutagen.flac import FLAC

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_false_flac import FF, LIB, ROOT, scan

OLD = os.path.join(ROOT, 'songs', 'Original nor converted')
TMP = os.path.join(ROOT, 'songs', '_convert_tmp')
LATTICE_GAIN = 228.1596  # Waiting For Love: 16-bit audio turned down 1 dB inside a 24-bit file

# file -> (mode, target rate, largest allowed null-test residual in dBFS)
JOBS = {
    'Love is War - supercell.flac': ('pad16', 44100, -100),
    'No Scrubs - with Rap - TLC.flac': ('pad16', 44100, -100),
    'Coin locker Baby - Maretu.flac': ('pad16', 44100, -100),
    'Waiting For Love - Avicii.flac': ('lattice16', 44100, -100),
    'Lone Digger - Caravan Palace.flac': ('every2nd', 44100, -90),
    'Everybody Wants To Rule The World - Tears For Fears.flac': ('soxr', 48000, -65),
    'So What - Miles Davis.flac': ('soxr', 96000, -80),
    'The Boxer - Simon & Garfunkel.flac': ('soxr', 96000, -80),
}
for name in ('Altale [Duo Rework] - Sakuzyo Official', 'CENSORED!! - t+pazolite', 'Fracture Ray - Sakuzyo Official',
             'Galaxy Collapse - 黒皇帝', 'Hatsune Miku - Tell Your World', 'Inochi ni Kirawarete iru. Cover by Mafumafu',
             'MEGALOVANIA (Camellia Remix) - Camellia', 'Marigold - M2U & NICODE', 'Oriens - GINKIHA',
             'THE END OF HATSUNE MIKU - cosMo@Bousou-P', 'THE INTENSE VOICE OF HATSUNE MIKU = cosMo@Bousou-P',
             'THE WORLD REVOLVING (Camellia Remix) - Camellia', 'Wish Upon a Shooting Star - SUi - Deemo 2.4',
             '[IA] A Tale of Six Trillion Years and a Night', 'real THE END OF HATSUNE MIKU - cosMo@Bousou-P feat. GUMI'):
    JOBS['Other/' + name + '.flac'] = ('tpdf16', 48000, -85)


def decode(path, extra=()):
    pr = subprocess.Popen([FF, '-v', 'error', '-nostdin', '-i', path, '-map', '0:a:0', *extra, '-f', 's32le', '-c:a', 'pcm_s32le', '-'],
                          stdout=subprocess.PIPE)
    left = b''
    while True:
        raw = pr.stdout.read(1 << 23)
        if not raw:
            break
        raw = left + raw
        cut = len(raw) // 8 * 8
        left = raw[cut:]
        yield np.frombuffer(raw[:cut], '<i4').reshape(-1, 2)
    if pr.wait():
        raise RuntimeError('decode failed: ' + path)


def encoder(out, rate, bits):
    fmt = ['-f', 's16le'] if bits == 16 else ['-f', 's32le']
    enc = ['-sample_fmt', 's16'] if bits == 16 else ['-sample_fmt', 's32', '-bits_per_raw_sample', '24']
    return subprocess.Popen([FF, '-v', 'error', '-nostdin', '-y', *fmt, '-ar', str(rate), '-ac', '2', '-i', '-', '-map_metadata', '-1',
                             '-c:a', 'flac', '-compression_level', '8', *enc, out], stdin=subprocess.PIPE)


def write_pcm(src, out, mode, rate):
    """Feed the converted samples to the encoder. Returns (frames written, md5 of the samples written, stats)."""
    bits = 16 if mode in ('pad16', 'lattice16', 'tpdf16') else 24
    pr = encoder(out, rate, bits)
    md5 = hashlib.md5()
    frames = 0
    moved = 0
    rng = np.random.default_rng(20261105)
    odd = 0
    for a in decode(src):
        if mode == 'pad16':
            x = a >> 8
            k = np.clip((x + 128) >> 8, -32768, 32767)
            moved += int((x & 0xFF).any(axis=1).sum())
        elif mode == 'lattice16':
            x = (a >> 8).astype(np.float64)
            k = np.round(x / LATTICE_GAIN)
            moved += int((np.abs(x - k * LATTICE_GAIN) > 2).any(axis=1).sum())
            k = np.clip(k, -32768, 32767)
        elif mode == 'tpdf16':
            x = a / 65536.0  # 16-bit units
            k = np.floor(x + rng.random(x.shape) - rng.random(x.shape) + 0.5)
            k = np.clip(k, -32768, 32767)
        elif mode == 'every2nd':
            x = a >> 8
            start = odd  # keep positions 0, 2, 4... of the whole stream across read boundaries
            k = x[start::2]
            odd = (start + len(x)) % 2
        if bits == 16:
            b = k.astype('<i2').tobytes()
            md5.update(b)
        else:
            b = (k.astype('<i4') << 8).tobytes()
            md5.update(np.frombuffer(b, 'u1').reshape(-1, 4)[:, 1:].tobytes())
        pr.stdin.write(b)
        frames += len(k)
    pr.stdin.close()
    if pr.wait():
        raise RuntimeError('encode failed')
    return frames, md5.hexdigest(), moved


def soxr_flac(src, out, rate):
    subprocess.run([FF, '-v', 'error', '-nostdin', '-y', '-i', src, '-map', '0:a:0', '-map_metadata', '-1',
                    '-af', f'aresample={rate}:resampler=soxr:precision=28:osf=s32',
                    '-c:a', 'flac', '-compression_level', '8', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', out], check=True)


def null_test(src, out, mode, rate, src_rate):
    """Level of what changed: the new file, brought back to the original's rate and scale, minus the original."""
    if mode == 'every2nd':
        # exact band-limited rebuild; a resampler would roll off the content right below Nyquist and blame the file
        x = np.vstack(list(decode(src))) / 2147483648.0
        y = np.vstack(list(decode(out))) / 2147483648.0
        m = len(y) * 2
        x = x[:m]
        power = 0.0
        peak = 0.0
        for ch in (0, 1):
            rebuilt = np.fft.irfft(np.fft.rfft(y[:, ch]), m) * 2
            # the two ends are wrapped by the circular FFT, so leave 1 s each side out
            d = (x[:, ch] - rebuilt[:len(x)])[88200:-88200]
            power += float((d ** 2).sum())
            peak = max(peak, float(np.abs(d).max()))
        rms = 10 * np.log10(power / (2 * (len(x) - 176400)) + 1e-30)
        return round(rms, 1), round(20 * np.log10(peak + 1e-12), 1), len(x)
    extra = () if rate == src_rate else ('-af', f'aresample={src_rate}:resampler=soxr:precision=28:osf=s32')
    scale = {'lattice16': LATTICE_GAIN * 256 / 65536}.get(mode, 1.0)
    power = 0.0
    n = 0
    peak = 0.0
    a_it, b_it = decode(src), decode(out, extra)
    a = np.zeros((0, 2), np.float64)
    b = np.zeros((0, 2), np.float64)
    a_done = b_done = False
    while True:
        while len(a) < 1 << 20 and not a_done:
            try:
                a = np.vstack((a, next(a_it) / 2147483648.0))
            except StopIteration:
                a_done = True
        while len(b) < 1 << 20 and not b_done:
            try:
                b = np.vstack((b, next(b_it) / 2147483648.0 * scale))
            except StopIteration:
                b_done = True
        m = min(len(a), len(b))
        if not m:
            break
        d = a[:m] - b[:m]
        power += float((d ** 2).sum())
        peak = max(peak, float(np.abs(d).max()))
        n += d.size
        a, b = a[m:], b[m:]
    rms = 10 * np.log10(power / max(n, 1) + 1e-30)
    return round(rms, 1), round(20 * np.log10(peak + 1e-12), 1), n // 2


def copy_tags(src, out):
    s = FLAC(src)
    d = FLAC(out)
    d.clear()
    d.clear_pictures()
    if d.tags is None:
        d.add_tags()
    for k, v in (s.tags or []):
        d.tags.append((k, v))
    for p in s.pictures:
        d.add_picture(p)
    d.save()
    t = FLAC(out)
    if sorted(t.tags or []) != sorted(s.tags or []) or [p.data for p in t.pictures] != [p.data for p in s.pictures]:
        raise RuntimeError('tags or cover did not copy')


def convert(item):
    rel, (mode, rate, limit) = item
    src = os.path.join(LIB, rel)
    out = os.path.join(TMP, hashlib.md5(rel.encode()).hexdigest() + '.flac')
    r = dict(file=rel, mode=mode)
    try:
        before = FLAC(src).info
        r.update(old_bits=before.bits_per_sample, old_rate=before.sample_rate, old_size=os.path.getsize(src))
        want_frames = None
        want_md5 = None
        moved = 0
        if mode == 'soxr':
            soxr_flac(src, out, rate)
        else:
            want_frames, want_md5, moved = write_pcm(src, out, mode, rate)
        copy_tags(src, out)
        chk = scan(out)
        r.update(new_bits=chk['bits'], new_rate=chk['rate'], new_size=os.path.getsize(out), new_kbps=chk['kbps'], frames_off_lattice=moved)
        bad = []
        if chk['rc'] or chk['err']: bad.append('decode error ' + chk['err'])
        if chk['md5_ok'] is not True: bad.append('md5 not ok')
        if chk['rate'] != rate: bad.append('rate')
        if chk['bits'] != (24 if mode in ('soxr', 'every2nd') else 16): bad.append('bits')
        if want_md5 and chk['md5_stored'] != want_md5: bad.append('md5 differs from what was fed')
        if want_frames is not None and chk['decoded'] != want_frames: bad.append('frame count')
        if abs(chk['sec'] - before.length) > 0.05: bad.append(f"length {chk['sec']} vs {before.length}")
        if os.path.getsize(out) >= os.path.getsize(src): bad.append('not smaller')
        rms, peak, frames = null_test(src, out, mode, rate, before.sample_rate)
        r.update(null_rms=rms, null_peak=peak, compared=frames)
        if rms > limit: bad.append(f'null {rms} dB above limit {limit}')
        if abs(frames - before.total_samples) > before.sample_rate // 10: bad.append(f'compared only {frames} of {before.total_samples} frames')
        r['sec'] = chk['sec']; r['peak_db'] = chk['peak_db']; r['full'] = chk['full']; r['md5_ok'] = chk['md5_ok']
        r['bad'] = bad
    except Exception as e:
        r['bad'] = [repr(e)]
    return r, out


if __name__ == '__main__':
    report = sys.argv[1]
    dry = '--dry-run' in sys.argv
    os.makedirs(TMP, exist_ok=True)
    with Pool(8) as pool:
        results = pool.map(convert, list(JOBS.items()), chunksize=1)
    for r, out in results:
        if not r['bad'] and not dry:
            keep = os.path.join(OLD, r['file'])
            os.makedirs(os.path.dirname(keep), exist_ok=True)
            shutil.move(os.path.join(LIB, r['file']), keep)
            shutil.move(out, os.path.join(LIB, r['file']))
            r['replaced'] = True
        print('OK ' if not r['bad'] else 'BAD', r.get('old_bits'), r.get('old_rate'), '->', r.get('new_bits'), r.get('new_rate'),
              round(r.get('old_size', 0) / 1e6, 1), '->', round(r.get('new_size', 0) / 1e6, 1), 'MB null', r.get('null_rms'), r.get('null_peak'),
              'moved', r.get('frames_off_lattice'), r['file'], r['bad'], flush=True)
    with open(report, 'w', encoding='utf-8') as fh:
        json.dump([r for r, _ in results], fh, ensure_ascii=False, indent=1)
    if not dry and all(r.get('replaced') for r, _ in results):
        shutil.rmtree(TMP, ignore_errors=True)
