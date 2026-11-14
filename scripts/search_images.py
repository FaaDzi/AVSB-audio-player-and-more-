"""Fill in IEM photos that no shop feed has, using the Brave Search image API.

Reads the API key from .secrets/brave_api_key.txt (never committed). Processes at most
--budget searches per run (to stay inside the free allowance), most useful IEMs first
(reviewed ones, then the most-measured). For each IEM it keeps only results whose title
or page URL contains the model name, prefers shop/brand pages and plain backgrounds,
downloads Brave's thumbnail, removes a plain background and saves a small WebP.
Progress is kept in data/raw/search_images/state.json, so runs resume where they stopped.

Usage: python -I scripts/search_images.py [--budget 60] [--log FILE] [--task-name NAME]
"""
import argparse
import datetime
import io
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
import numpy as np  # noqa: E402
from build_images import tokens, find  # noqa: E402
from clean_backgrounds import clean, plainness  # noqa: E402
from names import base  # noqa: E402
from PIL import Image  # noqa: E402
from stores import DOMAINS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
KEY_FILE = ROOT / ".secrets" / "brave_api_key.txt"
CATALOG = ROOT / "app" / "public" / "data" / "iems.json"
REVIEWS = ROOT / "app" / "public" / "data" / "reviews.json"
IMAGES = ROOT / "app" / "public" / "data" / "images.json"
SEARCHED = ROOT / "app" / "public" / "data" / "images_search.json"
IMG_DIR = ROOT / "app" / "public" / "img" / "iem"
STATE = ROOT / "data" / "raw" / "search_images" / "state.json"
API = "https://api.search.brave.com/res/v1/images/search"
SIZE = 200
TRUSTED = set(DOMAINS) | {"headfi.org", "www.head-fi.org", "squig.link", "aliexpress.com", "www.aliexpress.com", "amazon.com", "www.amazon.com"}
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
LOG = None


def say(msg):
    line = f"{datetime.datetime.now():%Y-%m-%d %H:%M} {msg}"
    if LOG:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    else:
        print(line, flush=True)


def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (iem-tournament personal project)", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def queue():
    """Models without a photo, most useful first."""
    iems = json.loads(CATALOG.read_text(encoding="utf-8"))["iems"]
    have = set(json.loads(IMAGES.read_text(encoding="utf-8"))) if IMAGES.exists() else set()
    rv = json.loads(REVIEWS.read_text(encoding="utf-8")) if REVIEWS.exists() else {}
    reviewed = set(rv.get("reviews", {})) | set(rv.get("comments", {})) | set(rv.get("videos", {}))
    models = {}
    for i in iems:
        b = base(i["name"])
        m = models.setdefault(b, {"name": b, "ids": [], "reviewed": False, "sources": 0})
        m["ids"].append(i["id"])
        m["reviewed"] |= i["id"] in reviewed
        m["sources"] = max(m["sources"], len(i["sources"]))
    todo = [m for m in models.values() if not any(x in have for x in m["ids"]) and len(tokens(m["name"])) >= 2]
    return sorted(todo, key=lambda m: (not m["reviewed"], -m["sources"], m["name"]))


def pick(model, results):
    t = tokens(model)
    best, best_score = None, -1e9
    for r in results:
        text = tokens(f"{r.get('title', '')} {urllib.parse.unquote(r.get('url', ''))}")
        if find(text, t) < 0:
            continue  # page isn't about this model
        thumb = (r.get("thumbnail") or {}).get("src")
        if not thumb:
            continue
        host = urllib.parse.urlparse(r.get("url", "")).netloc.lower()
        score = 2 if host in TRUSTED or any(host.endswith(d) for d in TRUSTED) else 0
        props = r.get("properties") or {}
        w, h = props.get("width") or 0, props.get("height") or 0
        if w and h and not 0.5 <= w / h <= 2:
            score -= 2  # banners / tall collages
        if score > best_score:
            best, best_score = r, score
    return best


def main():
    global LOG
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=int, default=60, help="max searches this run")
    ap.add_argument("--log")
    ap.add_argument("--task-name")
    args = ap.parse_args()
    LOG = args.log
    if not KEY_FILE.exists():
        say(f"no API key: put your Brave Search API key in {KEY_FILE}")
        return
    key = KEY_FILE.read_text(encoding="utf-8").strip()
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {"tried": {}}
    found = json.loads(SEARCHED.read_text(encoding="utf-8")) if SEARCHED.exists() else {}
    todo = [m for m in queue() if m["name"] not in state["tried"]]
    if not todo:
        say("every model has been searched")
        if args.task_name:
            subprocess.run(["schtasks", "/Delete", "/TN", args.task_name, "/F"], capture_output=True, creationflags=NO_WINDOW)
            say(f"removed scheduled task '{args.task_name}'")
        return
    say(f"{len(todo)} models left; searching up to {args.budget}")
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    done = 0
    for m in todo[: args.budget]:
        q = f"{m['name']} IEM"
        try:
            body = get(f"{API}?{urllib.parse.urlencode({'q': q, 'count': 20, 'safesearch': 'strict'})}",
                       {"Accept": "application/json", "X-Subscription-Token": key})
        except urllib.error.HTTPError as e:
            say(f"API error {e.code} on '{q}'; stopping this run")
            break
        time.sleep(1.1)  # free plan: 1 request per second
        results = json.loads(body).get("results", [])
        r = pick(m["name"], results)
        state["tried"][m["name"]] = "found" if r else "none"
        if r:
            try:
                img = Image.open(io.BytesIO(get(r["thumbnail"]["src"])))
                img.load()
                img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
                img.thumbnail((SIZE, SIZE))
                slug = re.sub(r"[^a-z0-9]+", "-", m["name"].lower()).strip("-")
                dest = IMG_DIR / f"{slug}.webp"
                img.save(dest, "WEBP", quality=70, method=6)
                cleaned = clean(dest)
                for i in m["ids"]:
                    found[i] = {"src": f"img/iem/{slug}.webp", "store": urllib.parse.urlparse(r.get("url", "")).netloc,
                                "url": r.get("url", ""), "title": r.get("title", ""), "search": True,
                                "plain": round(plainness(np.asarray(Image.open(dest).convert("RGB"))), 2), "bg": cleaned}
            except Exception as e:  # bad image: count as tried, move on
                state["tried"][m["name"]] = f"error: {e}"
        done += 1
        STATE.write_text(json.dumps(state, indent=0), encoding="utf-8")
        SEARCHED.write_text(json.dumps(found, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    say(f"searched {done}; images found so far: {len({v['src'] for v in found.values()})}")


if __name__ == "__main__":
    main()
