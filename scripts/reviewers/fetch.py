"""Polite fetcher: >=1.2s between requests, saves raw body + status. Usage: fetch.py OUTFILE URL"""
import sys, time, urllib.request, urllib.error, pathlib
UA = "Mozilla/5.0 (personal non-commercial IEM catalog research; contact: github.com/FaaDzi/AVSB-audio-player-and-more-)"
def fetch(url, out):
    time.sleep(1.2)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body, code = r.read(), r.status
    except urllib.error.HTTPError as e:
        body, code = e.read(), e.code
    except Exception as e:
        print("ERR", type(e).__name__, e, url); return None
    p = pathlib.Path(out); p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(body)
    print(code, len(body), url)
    return code
if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--list":  # file of alternating out/url lines; skips outputs that already exist
        lines = [l.strip() for l in open(args[1], encoding="utf8") if l.strip()]
        for i in range(0, len(lines), 2):
            if not pathlib.Path(lines[i]).exists():
                fetch(lines[i+1], lines[i])
        sys.exit()
    for i in range(0, len(args), 2):
        fetch(args[i+1], args[i])
