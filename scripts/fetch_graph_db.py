"""Download a reviewer's graph-tool measurements (CrinGraph/squig.link style) for personal use.

Saves phone_book.json and <file> L.txt / R.txt into data/raw/<name>/. One request at a
time with a short pause; existing files are skipped, so it can be re-run safely.

Usage: python -I scripts/fetch_graph_db.py jaysaudio|jaytiss
       python -I scripts/fetch_graph_db.py --squig-all [--type IEMs|Headphones|5128] [--workers 6]
         every database listed in squig.link's site directory, into data/raw/squig_dbs/<type>/<site>/
         (Crinacle's graph.hangout.audio is left out: his data is access-protected, see §10 of the plan)
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITES = {
    # name: (phone book URL, measurement directory URL)
    "jaysaudio": ("https://jaysaudio.github.io/data/phone_book.json", "https://jaysaudio.github.io/data/audio_db/"),
    "jaytiss": ("https://jaytiss.squig.link/data/phone_book.json", "https://jaytiss.squig.link/data/"),
}
DELAY_S = 0.25


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "iem-tournament personal project"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main(name):
    book_url, data_url = SITES[name]
    fetch_db(ROOT / "data" / "raw" / name, book_url, data_url)


def fetch_db(out: Path, book_url: str, data_url: str, quiet: bool = False):
    (out / "fr").mkdir(parents=True, exist_ok=True)
    (out / "phone_book.json").write_bytes(get(book_url))
    book = json.loads((out / "phone_book.json").read_text(encoding="utf-8"))
    files = []
    for brand in book:
        for phone in brand.get("phones", []) if isinstance(brand, dict) else []:
            f = phone.get("file") if isinstance(phone, dict) else None
            files += [x for x in (f if isinstance(f, list) else [f]) if isinstance(x, str) and x]

    done = missing = 0
    for i, f in enumerate(files):
        for ch in ("L", "R"):
            dest = out / "fr" / f"{f} {ch}.txt"
            if dest.exists():
                continue
            try:
                body = get(data_url + urllib.parse.quote(f"{f} {ch}.txt"))
                if body.lstrip()[:1] == b"<":  # HTML error page served with 200
                    raise urllib.error.HTTPError(data_url, 404, "html", None, None)
                dest.write_bytes(body)
                done += 1
            except urllib.error.HTTPError as e:
                missing += 1
                print(f"{e.code} {f} {ch}")
            time.sleep(DELAY_S)
        if i % 50 == 0 and not quiet:
            print(f"{i}/{len(files)}", flush=True)
    print(f"{out.name}: downloaded {done}, missing {missing}, total files {len(files)}", flush=True)
    return done, missing


SKIP_SITES = {"crinacle"}


def squig_all(db_type: str, workers: int):
    sites = json.loads(get("https://squig.link/squigsites.json"))
    jobs = []
    for s in sites:
        if s["username"] in SKIP_SITES:
            continue
        for db in s["dbs"]:
            if db["type"] != db_type:
                continue
            if s["urlType"] == "root":
                base = "https://squig.link"
            elif s["urlType"] == "subdomain":
                base = f"https://{s['username']}.squig.link"
            elif s["urlType"] == "labFolder":
                base = f"https://squig.link/lab/{s['username']}"
            else:
                base = (s.get("altDomain") or "").rstrip("/")
            if not base:
                continue
            data_url = base + db["folder"].rstrip("/") + "/data/"
            jobs.append((ROOT / "data" / "raw" / "squig_dbs" / db_type / s["username"], data_url + "phone_book.json", data_url))

    def run(job):
        out, book, data = job
        try:
            return fetch_db(out, book, data, quiet=True)
        except Exception as e:  # one broken site doesn't stop the rest
            print(f"{out.name}: failed ({e})", flush=True)
            return 0, 0

    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(run, jobs))
    print(f"{len(jobs)} databases, {sum(r[0] for r in results)} files downloaded")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # model names in the log aren't all ASCII
    if sys.argv[1] == "--squig-all":
        args = dict(zip(sys.argv[2::2], sys.argv[3::2]))
        squig_all(args.get("--type", "IEMs"), int(args.get("--workers", 6)))
    else:
        main(sys.argv[1])
