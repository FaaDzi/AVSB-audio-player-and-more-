# Full-decode truth scan of songs/lossless: what each FLAC claims vs what its samples hold.
# Read-only on the music. Writes one JSON line per file, and resumes if run again.
#   python scripts/scan_false_flac.py <out.jsonl> [workers]
import glob, hashlib, json, os, subprocess, sys
from multiprocessing import Pool

import numpy as np
from mutagen.flac import FLAC

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FF = os.path.join(ROOT, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe')
LIB = os.path.join(ROOT, 'songs', 'lossless')
BAND_HZ = 250
SMALL = 1 << 12  # values below this should all occur in real audio of that depth
EPS = 1e-30


def scan(path):
    rel = os.path.relpath(path, LIB).replace('\\', '/')
    f = FLAC(path)
    i = f.info
    pic = sum(len(p.data) for p in f.pictures)
    tags = {k: v for k, v in (f.tags or []) if k.lower() in ('encoder', 'encodedby', 'encoded_by', 'comment', 'description', 'source', 'purl', 'major_brand', 'url', 'www')}
    bps = i.bits_per_sample
    rate = i.sample_rate
    size = os.path.getsize(path)
    audio_kbps = (size - pic) * 8 / max(i.length, 1e-6) / 1000

    # about 11 Hz per bin whatever the rate
    nfft = int(2 ** round(np.log2(rate / 11)))
    win = np.hanning(nfft)
    norm = (win.sum() / 2) ** 2  # a full-scale sine reads 0 dB
    freqs_per_band = max(1, int(round(BAND_HZ * nfft / rate)))
    edges = np.arange(0, nfft // 2 + 1, freqs_per_band)

    pr = subprocess.Popen([FF, '-v', 'error', '-nostdin', '-i', path, '-map', '0:a:0', '-f', 's32le', '-c:a', 'pcm_s32le', '-'],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    md5 = hashlib.md5()
    shift = 32 - bps
    used = np.zeros(1 << bps, bool)
    low = np.zeros(256, np.int64)
    ored = 0
    n = 0
    lr_same = 0
    peak = 0
    full = 0
    block_means = []
    tail = np.zeros((0, 2), np.int32)
    read = 1 << 23
    while True:
        raw = pr.stdout.read(read)
        if not raw:
            break
        if len(raw) % 8:
            more = pr.stdout.read(8 - len(raw) % 8)
            raw += more
        a = np.frombuffer(raw[:len(raw) // 8 * 8], '<i4').reshape(-1, 2)
        if bps == 16:
            md5.update((a >> 16).astype('<i2').tobytes())
        else:
            md5.update(np.frombuffer(a.tobytes(), 'u1').reshape(-1, 4)[:, 1:].tobytes())
        x = a >> shift
        n += len(x)
        flat = x.ravel()
        used[flat + (1 << (bps - 1))] = True
        low += np.bincount((flat & 0xFF).astype(np.int64), minlength=256)
        ored |= int(np.bitwise_or.reduce(flat))
        lr_same += int((x[:, 0] == x[:, 1]).sum())
        m = np.abs(flat.astype(np.int64))
        peak = max(peak, int(m.max()))
        full += int((m >= (1 << (bps - 1)) - 1).sum())

        buf = np.vstack((tail, a))
        frames = len(buf) // nfft
        tail = buf[frames * nfft:]
        if frames:
            y = buf[:frames * nfft].astype(np.float64) / 2147483648.0
            lvl = []
            for ch in (0, 1):
                seg = y[:, ch].reshape(frames, nfft)
                seg = seg[np.abs(seg).max(axis=1) > 1e-6]
                if len(seg):
                    p = np.abs(np.fft.rfft(seg * win, axis=1)) ** 2 / norm
                    lvl.append(np.add.reduceat(p, edges, axis=1).mean(axis=0))
            if lvl:
                block_means.append(np.mean(lvl, axis=0))
    err = pr.stderr.read().decode('utf-8', 'replace').strip()
    rc = pr.wait()

    bm = np.array(block_means) if block_means else np.zeros((1, len(edges))) + EPS
    mean_db = 10 * np.log10(bm.mean(axis=0) + EPS)
    p90_db = 10 * np.log10(np.percentile(bm, 90, axis=0) + EPS)
    uniq = int(used.sum())
    mid = 1 << (bps - 1)
    small = used[mid - SMALL:mid + SMALL]
    tot = max(int(low.sum()), 1)
    ref_md5 = '%032x' % i.md5_signature
    return dict(
        file=rel, bits=bps, rate=rate, ch=i.channels, sec=round(i.length, 2), size=size, pic=pic,
        kbps=round(audio_kbps), vendor=getattr(f.tags, 'vendor', '') if f.tags else '', tags=tags,
        decoded=n, declared=i.total_samples, rc=rc, err=err[:300],
        md5_stored=ref_md5, md5_ok=None if i.md5_signature == 0 else ref_md5 == md5.hexdigest(),
        trailing_zero_bits=(bps if ored == 0 else int(np.log2(ored & -ored))),
        uniq=uniq, small_occ=round(int(small.sum()) / (2 * SMALL), 4),
        low0=round(int(low[0]) / tot, 5),
        low_near0=round(int(low[[0, 1, 2, 3, 253, 254, 255]].sum()) / tot, 5),
        lr_same=round(lr_same / max(n, 1), 5), peak=peak, peak_db=round(20 * np.log10(max(peak, 1) / (1 << (bps - 1))), 2), full=full,
        band_hz=rate / nfft * freqs_per_band,
        mean_db=[round(float(v), 1) for v in mean_db],
        p90_db=[round(float(v), 1) for v in p90_db],
    )


def work(path):
    try:
        return scan(path)
    except Exception as e:
        return dict(file=os.path.relpath(path, LIB).replace('\\', '/'), fail=repr(e))


if __name__ == '__main__':
    out = sys.argv[1]
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    done = set()
    if os.path.exists(out):
        with open(out, encoding='utf-8') as fh:
            done = {json.loads(l)['file'] for l in fh if l.strip()}
    todo = [p for p in sorted(glob.glob(os.path.join(LIB, '**', '*.flac'), recursive=True))
            if os.path.relpath(p, LIB).replace('\\', '/') not in done]
    print(len(done), 'already done,', len(todo), 'to scan', flush=True)
    with Pool(workers) as pool, open(out, 'a', encoding='utf-8') as fh:
        for c, r in enumerate(pool.imap_unordered(work, todo), 1):
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
            fh.flush()
            if c % 50 == 0:
                print(c, '/', len(todo), flush=True)
    print('done', flush=True)
