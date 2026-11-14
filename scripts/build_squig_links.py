"""Link each IEM and headphone to its graph on the reviewer's squig.link site.

For every measurement source that has a squig.link (CrinGraph) site, download its phone book,
then link an IEM to the first of its sources whose phone book has the same model (same
normalised name as the catalogue uses). No match -> no link; the app still draws the graph itself.

Headphones (headphones.json) use the headphone databases fetched by
`fetch_graph_db.py --squig-all --type Headphones`; their page is the site's headphone folder.

Output: app/public/data/squig.json  (IEM or headphone id -> {"url", "reviewer"})
Cache:  data/raw/squig/<host>.json, data/raw/squig/squigsites.json
Usage:  python -I scripts/build_squig_links.py
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling modules under python -I
from names import key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "squig"
CATALOG = ROOT / "app" / "public" / "data" / "iems.json"
HEADPHONES = ROOT / "app" / "public" / "data" / "headphones.json"
HP_DBS = ROOT / "data" / "raw" / "squig_dbs" / "Headphones"
OUT = ROOT / "app" / "public" / "data" / "squig.json"

# measurement source (as in iems.json) -> graph site host. Hi End Portable has no squig site.
SITES = {
    "Super Review": "squig.link",
    "Jaytiss (squig.link)": "jaytiss.squig.link",
    "Jaytiss": "jaytiss.squig.link",
    "Jay Audio (jaysaudio.github.io)": "jaysaudio.github.io",
    "ToneDeafMonk": "tonedeafmonk.squig.link",
    "Harpo": "harpo.squig.link",
    "RikudouGoku": "rg.squig.link",
    "Kazi": "kazi.squig.link",
    "Fahryst": "fahryst.squig.link",
    "Regan Cipher": "regancipher.squig.link",
    "kr0mka": "kr0mka.squig.link",
    "Bakkwatan": "bakkwatan.squig.link",
    "freeryder05": "freeryder05.squig.link",
    "Filk": "filk.squig.link",
    "DHRME": "dhrme.squig.link",
}


DBS = ROOT / "data" / "raw" / "squig_dbs" / "IEMs"  # fetched by fetch_graph_db.py --squig-all


def phone_book(host):
    # a phone book downloaded with the graphs is the freshest copy
    site = "superreview" if host == "squig.link" else host.removesuffix(".squig.link")
    fresh = DBS / site / "phone_book.json"
    if fresh.exists():
        return json.loads(fresh.read_text(encoding="utf-8"))
    path = CACHE / f"{host}.json"
    if not path.exists():
        req = urllib.request.Request(f"https://{host}/data/phone_book.json", headers={"User-Agent": "iem-tournament personal project"})
        with urllib.request.urlopen(req, timeout=30) as r:
            path.write_bytes(r.read())
        time.sleep(1)
    return json.loads(path.read_text(encoding="utf-8"))


def index(book):
    """normalised model name -> squig file name (first file = the default sample)."""
    out = {}
    for brand in book:
        for phone in brand.get("phones", []) if isinstance(brand, dict) else []:
            if not isinstance(phone, dict) or not phone.get("file"):
                continue
            files = phone["file"] if isinstance(phone["file"], list) else [phone["file"]]
            name = f"{brand.get('name', '')} {phone.get('name', '')}".strip()
            out.setdefault(key(name), files[0])
            for f in files[1:]:  # graph-tool variants appear as "Name (file)" in the catalogue
                out.setdefault(key(f"{name} ({f})"), f)
    return out


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    iems = catalog["iems"]
    # every squig.link site build_iem_data.py took graphs from ("<site> (squig.link)")
    for src in catalog["calibration"]:
        if src.endswith(" (squig.link)") and src not in SITES:
            SITES[src] = f"{src.removesuffix(' (squig.link)')}.squig.link"
    books = {}
    for host in sorted(set(SITES.values())):
        try:
            books[host] = index(phone_book(host))
        except Exception as e:
            print(f"skip {host}: {e}")
    links = {}
    for iem in iems:
        sources = [iem["source"]] + [s for s in iem["sources"] if s != iem["source"]]
        for src in sources:
            host = SITES.get(src)
            f = books.get(host, {}).get(key(iem["name"])) if host else None
            if f:
                share = urllib.parse.quote(f.replace(" ", "_"), safe="_-.()")
                links[iem["id"]] = {"url": f"https://{host}/?share={share}", "reviewer": src.split(" (")[0]}
                break
    n_iems = len(links)
    n_hp = headphone_links(links)
    OUT.write_text(json.dumps(links, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{n_iems}/{len(iems)} IEMs and {n_hp} headphones linked to a squig graph -> {OUT}")


# AutoEq headphone sources that are also squig.link sites (username in squigsites.json)
HP_AUTOEQ = {"Super Review": "superreview", "Kuulokenurkka": "kuulokenurkka", "kr0mka": "kr0mka",
             "Auriculares Argentina": "auricularesargentina"}


def headphone_pages():
    """squig username -> page URL of its headphone database."""
    path = CACHE / "squigsites.json"
    if not path.exists():
        req = urllib.request.Request("https://squig.link/squigsites.json", headers={"User-Agent": "iem-tournament personal project"})
        with urllib.request.urlopen(req, timeout=30) as r:
            path.write_bytes(r.read())
    pages = {}
    for s in json.loads(path.read_text(encoding="utf-8")):
        base = {"root": "https://squig.link", "subdomain": f"https://{s['username']}.squig.link",
                "labFolder": f"https://squig.link/lab/{s['username']}"}.get(s["urlType"], (s.get("altDomain") or "").rstrip("/"))
        for db in s["dbs"]:
            if db["type"] == "Headphones" and base:
                pages[s["username"]] = base + db["folder"]
    return pages


def headphone_links(links):
    phones = json.loads(HEADPHONES.read_text(encoding="utf-8"))["iems"]
    pages = headphone_pages()
    books = {}
    for folder in HP_DBS.glob("*"):
        if folder.name in pages and (folder / "phone_book.json").exists():
            books[folder.name] = index(json.loads((folder / "phone_book.json").read_text(encoding="utf-8")))
    n = 0
    for hp in phones:
        sources = [hp["source"]] + [s for s in hp["sources"] if s != hp["source"]]
        for src in sources:
            user = HP_AUTOEQ.get(src) or (src.removesuffix(" (squig.link)") if src.endswith(" (squig.link)") else None)
            f = books.get(user, {}).get(key(hp["name"]))
            if f:
                share = urllib.parse.quote(f.replace(" ", "_"), safe="_-.()")
                links[hp["id"]] = {"url": f"{pages[user]}?share={share}", "reviewer": src.split(" (")[0]}
                n += 1
                break
    return n


if __name__ == "__main__":
    main()
