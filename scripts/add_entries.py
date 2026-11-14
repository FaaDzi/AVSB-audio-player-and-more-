"""Add list entries to songs/manifest.json without fetching any audio (plan §54.1).

Each entry gets the next number after the highest one already used (songs/originals and the
manifest), and a fileName "NNN - Artist - Title" that buildLibrary matches when that file is put in
songs/originals (from any source the owner has the rights to: a CD rip, a Bandcamp purchase...).
clip and level stay empty until the analysis script sees the file. Idempotent: an entry whose
artist + title is already in the manifest is skipped.

Usage: python -I scripts/add_entries.py [--dry-run]
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# the master list; `npm run sync-data` (also before dev/build) copies it to app/public/data/songs.json
MANIFEST = ROOT / "songs" / "manifest.json"
ORIGINALS = ROOT / "songs" / "originals"

# (artist, title, album, year, category, also, genre)
NEW = [
    # the owner's picks (names checked against Spotify / Bandcamp / Wikipedia, 2026-11-01)
    ("Walter Egan", "Magnet and Steel", "Not Shy", 1978, "vocals", ["stage"], "rock"),
    ("Röyksopp feat. Susanne Sundfør", "Oh, Lover", "Profound Mysteries II", 2022, "stage", ["bass"], "electronic"),
    ("Röyksopp feat. Jamie Irrepressible", "Sorry", "Profound Mysteries", 2022, "vocals", [], "electronic"),
    ("haer", "Sugar", "Sugar", 2020, "vocals", [], "pop"),
    ("Keane", "We Might As Well Be Strangers", "Hopes and Fears", 2004, "vocals", ["stage"], "rock"),
    ("slenderbodies", "lucid", "lucid", 2017, "stage", ["vocals"], "indie"),
    ("Yael Naim", "Daddy", "nightsongs", 2020, "acoustic", ["vocals"], "folk"),
    ("Mr FijiWiji feat. Openwater", "Growing Up", "Growing Up EP", 2015, "bass", ["treble"], "electronic"),
    ("Tunng", "The Pioneers", "Comments of the Inner Chorus", 2006, "acoustic", ["stage"], "folk"),
    ("A Perfect Circle", "Weak and Powerless", "Thirteenth Step", 2003, "busy", ["bass"], "rock"),
    ("Plini", "Ona / 1154", "Impulse Voices", 2020, "busy", ["stage"], "rock"),
    ("Chuck Mangione", "The XIth Commandment", "Feels So Good", 1977, "treble", ["acoustic"], "jazz"),
    ("Idealism", "how many stars are there", "rainy evening", 2016, "stage", ["bass"], "lo-fi"),
    ("Gotye feat. Kimbra", "Somebody That I Used to Know", "Making Mirrors", 2011, "stage", ["vocals"], "indie"),
    ("HUNTR/X", "Golden", "KPop Demon Hunters (Soundtrack)", 2025, "vocals", ["treble"], "k-pop"),
    ("K/DA", "POP/STARS", "POP/STARS", 2018, "bass", ["vocals"], "k-pop"),
    # proposed to fill the thin categories (approved in plan §54)
    ("Norah Jones", "Don't Know Why", "Come Away with Me", 2002, "acoustic", ["vocals"], "jazz"),
    ("Agnes Obel", "Riverside", "Philharmonics", 2010, "acoustic", ["vocals"], "folk"),
    ("José González", "Heartbeats", "Veneer", 2003, "acoustic", [], "folk"),
    ("Damien Rice", "The Blower's Daughter", "O", 2002, "acoustic", ["vocals"], "folk"),
    ("Alison Krauss", "Ghost in This House", "Forget About It", 1999, "acoustic", ["vocals"], "country"),
    ("Kings of Convenience", "I'd Rather Dance with You", "Riot on an Empty Street", 2004, "acoustic", ["stage"], "folk"),
    ("Jack Johnson", "Better Together", "In Between Dreams", 2005, "acoustic", [], "folk"),
    ("Iron & Wine", "Naked as We Came", "Our Endless Numbered Days", 2004, "acoustic", ["vocals"], "folk"),
    ("Rodrigo y Gabriela", "Tamacun", "Rodrigo y Gabriela", 2006, "acoustic", ["busy"], "folk"),
    ("Paco de Lucía", "Entre dos aguas", "Fuente y caudal", 1973, "acoustic", ["busy"], "flamenco"),
    ("Hozier", "Take Me to Church", "Hozier", 2014, "vocals", ["bass"], "indie"),
    ("Sade", "No Ordinary Love", "Love Deluxe", 1992, "vocals", ["bass"], "soul"),
    ("Jeff Buckley", "Hallelujah", "Grace", 1994, "vocals", ["acoustic"], "rock"),
    ("Lana Del Rey", "Video Games", "Born to Die", 2012, "vocals", ["stage"], "pop"),
    ("Lianne La Havas", "Bittersweet", "Lianne La Havas", 2020, "vocals", [], "soul"),
    ("Billie Eilish", "when the party's over", "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?", 2019, "vocals", ["stage"], "pop"),
    ("Etta James", "At Last", "At Last!", 1960, "vocals", [], "soul"),
    ("Pink Floyd", "Time", "The Dark Side of the Moon", 1973, "stage", ["busy"], "rock"),
    ("Hans Zimmer", "Time", "Inception (Music from the Motion Picture)", 2010, "stage", ["bass"], "soundtrack"),
    ("Sigur Rós", "Hoppípolla", "Takk...", 2005, "stage", ["busy"], "indie"),
    ("Mazzy Star", "Fade Into You", "So Tonight That I Might See", 1993, "stage", ["vocals"], "indie"),
    ("Björk", "Jóga", "Homogenic", 1997, "stage", ["bass"], "electronic"),
    ("Peter Gabriel", "Mercy Street", "So", 1986, "stage", [], "rock"),
    ("Daft Punk", "Giorgio by Moroder", "Random Access Memories", 2013, "stage", ["busy"], "electronic"),
    ("The Alan Parsons Project", "Eye in the Sky", "Eye in the Sky", 1982, "stage", [], "rock"),
    ("Fleet Foxes", "Mykonos", "Sun Giant", 2008, "stage", ["vocals"], "folk"),
    ("Toto", "Rosanna", "Toto IV", 1982, "treble", ["busy"], "rock"),
    ("Rush", "Tom Sawyer", "Moving Pictures", 1981, "treble", ["busy"], "rock"),
    ("Art Blakey & The Jazz Messengers", "Moanin'", "Moanin'", 1959, "treble", ["stage"], "jazz"),
    ("The Police", "Message in a Bottle", "Reggatta de Blanc", 1979, "treble", [], "rock"),
    ("Herbie Hancock", "Chameleon", "Head Hunters", 1973, "treble", ["bass"], "funk"),
    ("Vulfpeck", "Dean Town", "The Beautiful Game", 2016, "treble", ["bass"], "funk"),
    ("Steve Reich", "Music for 18 Musicians: Pulses", "Music for 18 Musicians", 1978, "treble", ["stage"], "classical"),
    ("Weather Report", "Birdland", "Heavy Weather", 1977, "treble", ["busy"], "jazz-rock"),
]


def safe(s: str) -> str:
    """A file-name-safe version, as the existing entries do it ("/" becomes "-")."""
    return re.sub(r'[\\:*?"<>|]+', "", s.replace("/", "-")).strip()


def key(artist: str, title: str) -> str:
    return re.sub(r"\W+", "", f"{artist}|{title}".lower())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    raw = MANIFEST.read_text(encoding="utf-8")
    crlf = "\r\n" in raw
    data = json.loads(raw)
    songs = data["songs"]
    have = {key(s["artist"], s["title"]) for s in songs}
    nums = [int(s["fileName"].split(" ")[0]) for s in songs if s.get("fileName", "")[:3].isdigit()]
    nums += [int(f.name[:3]) for f in ORIGINALS.glob("*") if f.name[:3].isdigit()]
    n = max(nums)
    added = []
    for artist, title, album, year, cat, also, genre in NEW:
        if key(artist, title) in have:
            print(f"skip (already listed): {artist} - {title}")
            continue
        n += 1
        added.append({
            "id": f"s-{n:03d}",
            "artist": artist,
            "title": title,
            "album": album,
            "year": year,
            "category": cat,
            "also": also,
            "genre": genre,
            "clip": {"start": None, "end": None},
            "fileName": f"{n:03d} - {safe(artist)} - {safe(title)}",
        })
    songs.extend(added)
    data["version"] = data.get("version", 0) + (1 if added else 0)
    print(f"{len(added)} added, {len(songs)} songs in total")
    print(dict(Counter(s["category"] for s in songs)))
    if "--dry-run" in sys.argv or not added:
        return
    out = json.dumps(data, ensure_ascii=False, indent=2) + ("\n" if raw.endswith("\n") else "")
    MANIFEST.write_text(out.replace("\n", "\r\n") if crlf else out, encoding="utf-8", newline="")


if __name__ == "__main__":
    main()
