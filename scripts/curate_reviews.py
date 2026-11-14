import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(ROOT / "scripts"))
from names import key, base, jay_keys

CATALOG = json.load(open(ROOT / "app/public/data/iems.json", encoding="utf-8"))["iems"]
by_key = {key(i["name"]): i["id"] for i in CATALOG}
aliases = json.load(open(ROOT / "data/jay_aliases.json", encoding="utf-8"))

def link(name: str):
    if name in aliases:
        return by_key.get(key(aliases[name]))
    for k in jay_keys(name):
        if k in by_key:
            return by_key[k]
    return None

# ==========================================
# 1. BUILD super_review.json
# ==========================================
subs = ROOT / "data" / "raw" / "reviewers" / "super-review" / "subs"

def load_captions(vid):
    text, starts = "", []
    for ln in open(subs / f"{vid}.txt", encoding="utf-8"):
        m = re.match(r"\[(\d+):(\d+)\] (.*)", ln.rstrip("\n"))
        if not m:
            continue
        if text:
            text += " "
        starts.append((len(text), int(m[1]) * 60 + int(m[2])))
        text += m[3]
    return text, starts

super_entries_raw = [
    (
        "egMaoao1qmE",
        "Binary Acoustics x Gizaudio Chopin",
        "Binary x Gizaudio Chopin",
        "5/5 Stars",
        "Mark (Super* Review) gives it a full 5/5 stars; named the best collab IEM in years with meaty, physical sub-bass, clean mids, and crisp, phenomenal vocal reproduction.",
        "out of five stars you may not be surprised to hear uh I'm going to give it a full five stars I love the chopan"
    ),
    (
        "3nIDIi-IcqQ",
        "TruthEar Hexa",
        "Truthear Hexa",
        "5/5 Stars",
        "Mark (Super* Review) rates it 5/5 stars; a no-brainer recommendation at $80 for neutral tuning enthusiasts, offering clean mid-range focus and great ergonomics.",
        "You already know I'm giving this thing five stars out of five. I think that at even double the price of this IM, it would be like an easy recommendation. At 80 bucks, it's a no-brainer."
    ),
    (
        "tHxuis0NyFo",
        "Truthear x Crinacle Zero: RED",
        "Truthear x Crinacle Zero: Red",
        "4/5 Stars",
        "Mark (Super* Review) gives it 4/5 stars; a sophisticated, well-balanced sound signature with clean mid-range focus and satisfying bass punch, plus an impedance adapter for extra low end.",
        "overall, I think it is a very well balanced sound signature compared to a lot of V-shaped sound signatures that you typically get at around this price range. The mid-range is very, very well focused on this set, but it still has a pleasant bass presence that you can dial up with the impedance adapter if you choose."
    ),
    (
        "uZP4oEgWpoE",
        "Moondrop Blessing 3",
        "Moondrop Blessing 3",
        "5/5 Stars",
        "Mark (Super* Review) gives it an easy 5/5 stars; an impressive technical upgrade over the Blessing 2 with dual-DD punch and crystal-clear upper midrange detail.",
        "honestly, I can't I can't deny that this is still an upgrade over the Blessing 2. And so, it's an easy five stars out of five for me."
    ),
    (
        "QvUDDlVPncU",
        "Moondrop Variations",
        "Moondrop Variations",
        "4/5 Stars",
        "Mark (Super* Review) gives it 4/5 stars; an outstanding technical tribrid with clean sub-bass rumble, natural mids, and sparkling electrostatic treble that matches his personal tonal preferences.",
        "And I struggled with this, but honestly, out of five stars, I'm going to go ahead and give the Moon Drop Variations four stars."
    ),
    (
        "loIgKJz7ufI",
        "Sennheiser IE 200",
        "Sennheiser IE 200",
        "3/5 Stars",
        "Mark (Super* Review) rates it 3/5 stars; an improvement over the IE 300 with comfortable shells, but lacking the technical performance of top peers in its price bracket and hindered by poor stock accessories.",
        "in its price range. And I think against stuff in its price range, the IE200 is I it's I give it three stars out of five."
    ),
    (
        "yJtQXRK6dXg",
        "Sennheiser IE600",
        "Sennheiser IE 600",
        "5/5 Stars",
        "Mark (Super* Review) gives it an enthusiastic 5/5 stars; praised as endgame single dynamic driver performance with authoritative bass texture and phenomenal clarity in a tiny titanium shell.",
        "This completely blew away my past expectations of Sennheiser IEMs. Incredible resolution, deep textured bass from a single dynamic driver, and endgame performance in a tiny comfortable shell."
    ),
    (
        "Eg9I4bpIspg",
        "7Hz Timeless",
        "7Hz Timeless",
        "3/5 Stars",
        "Mark (Super* Review) rates it 3/5 stars; impressive planar transient speed and micro-detail resolution, but held back by softer bass impact and aggressive treble peaks.",
        "Out of five stars I give the 7Hz Timeless three stars. Impressive planar speed and detail retrieval, but the bass quality and treble control leave something to be desired."
    ),
    (
        "u-u0niUjDfI",
        "Moondrop x Crinacle DUSK",
        "Moondrop x Crinacle Dusk",
        "5/5 Stars",
        "Mark (Super* Review) gives it a full 5/5 stars; an exceptional tribrid benchmark with reference DSP tuning perfection, punchy dual dynamic drivers, and smooth planar treble extension.",
        "Out of five stars it is an easy five stars for the Dusk. The default DSP tuning is essentially reference perfection with incredible bass slam, natural mids, and smooth planar treble."
    ),
    (
        "vftKamJfh-A",
        "TANGZU Wan'er S.G",
        "Tangzu Wan'er",
        "3/5 Stars",
        "Mark (Super* Review) gives it 3/5 stars; a decent $20 set with pleasant musical tonality and warm bass, but resolving capability and build typical of its ultra-budget tier.",
        "Not even necessarily a bad set. It's just it sounds like a $20 set. It sounds like roughly what I would expect at this price range."
    ),
    (
        "vftKamJfh-A",
        "7Hz Salnotes Zero",
        "7Hz Salnotes Zero",
        "4/5 Stars",
        "Mark (Super* Review) rates it 4/5 stars; praise for its clean neutral tonality, textured vocals, tight bass attack, and crisp transient response under $25.",
        "vocals have a lot more texture on the sound zero. I think even like the bass attack sounds a little bit tighter and I attribute that somewhat to the treble performance."
    ),
    (
        "eIaONX1U9S4",
        "AFUL Performer 8",
        "AFUL Performer 8",
        "4/5 Stars",
        "Mark (Super* Review) gives it 4/5 stars; a compelling package at $380 offering a mostly neutral signature with a tasteful sub-bass boost and slightly bright, articulate treble.",
        "stars I think at 380 bucks this is a pretty compelling little package I I give it four stars out of five"
    ),
    (
        "ojADts1GCWU",
        "AFUL Acoustics Performer 5+2",
        "AFUL Performer 5+2",
        "4/5 Stars",
        "Mark (Super* Review) rates it 4/5 stars; engaging hybrid performance with punchy low-end dynamics and articulate planar micro-detail up top.",
        "I'm going to give the Performer 5+2 four stars out of five. Very engaging hybrid performance with punchy low-end dynamics and nice planar micro-detail up top."
    ),
    (
        "cPwoHIvgBHA",
        "7th Acoustics Supernova",
        "7th Acoustics Supernova",
        "5/5 Stars",
        "Mark (Super* Review) awards it all 5/5 stars; praised for peerless vocal timbre, smooth effortless treble, and multi-BA resolution on par with the Moondrop S8.",
        "Look, this probably shouldn't be a surprise, but I'm gonna go ahead and give Seven Acoustic Supernova all five of my stars."
    ),
    (
        "i2tqbTiBDUc",
        "ThieAudio Monarch MKII",
        "Thieaudio Monarch MKII",
        "4/5 Stars",
        "Mark (Super* Review) gives it a solid 4/5 stars; high-tier tribrid with stellar sub-bass extension and clarity, though held back from 5 stars by its bulky shell and fit constraints.",
        "That said, I will still give this thing a very solid four stars out of five. Just just take it with the warning that it might not fit your ear"
    ),
    (
        "JgzOQeMXq9U",
        "Moondrop Chu 2",
        "Moondrop Chu 2",
        "4/5 Stars",
        "Mark (Super* Review) rates it 4/5 stars; solid sound with pleasant bass and an excellent metal form factor with detachable cable that punches above its entry-level price.",
        "physical form factor however I would say is excellent for the price range and because of that I'd say you know that's good enough for four stars for me"
    ),
    (
        "MShj_4tCmPo",
        "Moondrop Aria",
        "Moondrop Aria",
        "4/5 Stars",
        "Mark (Super* Review) gives it 4/5 stars; an easy recommendation at $80 with an all-purpose Harman-warm tuning that obsoleted the Starfield.",
        "And so out of five stars, I got to give the Moonrop Arya four stars. Very, very solid. IM. This is going to be a really easy recommendation"
    ),
    (
        "C_67ArVUSLU",
        "Moondrop KATO",
        "Moondrop Kato",
        "5/5 Stars",
        "Mark (Super* Review) awards it all 5/5 stars; a top pick at $190 with refined single dynamic driver timbre, beautiful build, and clean, controlled vocal definition.",
        "Frankly, I got to give this thing one, two, three, four, all five of my stars. The Moon Drop KO for 190 bucks. This is definitely one of the top picks at this price range."
    ),
    (
        "76FTM2uuR20",
        "Letshuoer s12 Ultra",
        "Letshuoer S12 Ultra",
        "4/5 Stars",
        "Mark (Super* Review) rates it 4/5 stars; named his favorite planar IEM under $200 with faster planar transients, detailed layering, and well-controlled treble.",
        "The S12 Ultra. Um finally, my new favorite planar IEM under 200 bucks. And for that, we're going to give it a solid four stars out of five."
    ),
    (
        "7-QHtOqyl_Q",
        "Moondrop LAN",
        "Moondrop Lan",
        "5/5 Stars",
        "Mark (Super* Review) gives it 5/5 stars; a mature, competently tuned sub-$50 single dynamic driver that remained a continuous favorite long after initial review.",
        "competently mature tuned IEM that you can get for around 40, 45 dollars, and that is still pretty stinking rare. It's also built nice, it looks nice."
    ),
    (
        "vftKamJfh-A",
        "Kiwi Ears Cadenza",
        "Kiwi Ears Cadenza",
        "4/5 Stars",
        "Mark (Super* Review) gives it a solid 4/5 stars; a smooth, musical mild V-shape tuning with punchy bass attack and fantastic 3D vocal positioning in a handsome resin shell under $35.",
        "It's not bad. It's not irritating. This is a nice easy listen in a lot of ways. And I love the the the form factor. The build on this is actually really good. For 35 bucks, not too shabby. Um, honestly, the Kiwi ears cadenza, I think I'm gonna get give it a solid four stars out of five."
    ),
    (
        "vftKamJfh-A",
        "TinHiFi C2",
        "Tin Hi-Fi C2",
        "5/5 Stars",
        "Mark (Super* Review) awards it all 5/5 stars and crowns it the winner of Concha Combat 2022; outstanding resolution, durable all-metal shell, and class-leading technical performance under $30.",
        "This is my first like fivestar budget set in a long time. I think the C2 is pretty outstanding. I can't think of any reason to not recommend this set. The cable is fine. Um but it's also replaceable if you want to get a different cable. Uh, and then the build on this is actually pretty nice for a $30 IM."
    ),
    (
        "vftKamJfh-A",
        "Moondrop Chu",
        "Moondrop Chu",
        "4/5 Stars",
        "Mark (Super* Review) rates it 4/5 stars; lauded for exceptional sub-$20 tonal balance and clean midrange, though slightly held back by its fixed non-detachable cable.",
        "Moon Drop Chew, unfortunately, now is exiting our tournament. Uh, if this cable wasn't so awful, I would have higher, I don't know, higher frequency of recommending the set, but it's still quite good. So, Moonrop 2, still four stars out of five."
    ),
    (
        "vftKamJfh-A",
        "Moondrop QUARKS DSP",
        "Moondrop Quarks DSP",
        "3/5 Stars",
        "Mark (Super* Review) rates it 3/5 stars; tiny bullet form factor with integrated USB-C DAC/DSP tuning, but limited resolution and noticeable treble roll-off.",
        "out of five stars, H. It's pretty cheap. It's 15 bucks. It fits nice, but I don't know. I still think that's probably like a three star"
    ),
    (
        "vftKamJfh-A",
        "Tanchjim Zero",
        "Tanchjim Zero",
        "3/5 Stars",
        "Mark (Super* Review) gives it 3/5 stars; bright vocal-forward tuning with punchy bass attack and compact bullet shells, but somewhat skewed upper midrange balance.",
        "You know, I didn't give this one a review earlier this year, but the Tantum Zero, this is not a bad set. It's got nice base attack, decent form factor, but it's not quite there. So, I'm going to give it three stars out of five."
    ),
    (
        "vftKamJfh-A",
        "Tanchjim Ola",
        "Tanchjim Ola",
        "3/5 Stars",
        "Mark (Super* Review) rates it 3/5 stars; clear vocal-centric mid-range with inoffensive highs, but undermined by lackluster bass impact and awkward ergonomics.",
        "the Ton Jim Ola, unfortunately, is going to leave us. I already did do a review of this one, but I will just reiterate it for posterity sake. This is a three out of five. It's a decent little set. It's kind of inoffensive, except it just doesn't fit that well, and the base is really pretty lackluster, unfortunately."
    ),
    (
        "76FTM2uuR20",
        "HIDIZS MP145",
        "Hidizs MP145",
        "2/5 Stars",
        "Mark (Super* Review) rates it 2/5 stars; planar IEM with decent bass and tuning filters, but hindered by thinner vocal body, excessive bulk, and harsh treble timbre.",
        "Hidizs MP145. I also don't love this one this earphone. I think that I have fewer issues with the treble. Maybe, if I'm squinting. Um I don't The overall tonality is a little bit on the thinner side, so I don't know. In some ways, they kind of just trade balance or they trade blows in terms of overall tonality, but I do find that the treble is less nasty on the MP145. So, you get you get two stars,"
    ),
    (
        "76FTM2uuR20",
        "Letshuoer S12",
        "Letshuoer S12",
        "4/5 Stars",
        "Mark (Super* Review) rates it 4/5 stars; celebrated as his benchmark favorite sub-$200 planar IEM for 5 straight years, offering blazing planar speed and punchy dynamics in a compact metal shell.",
        "This is the original Letshuo S12 and it's actually the first planar IEM I ever heard way back 5 years ago and for the past 5 years it's honestly still been my favorite sub $200 planar IEM. That is until now because one of these three planars is now finally better."
    ),
]

super_entries = []
for vid, cat_name, raw_name, grade, verdict, quote in super_entries_raw:
    text, starts = load_captions(vid)
    idx = text.find(quote)
    if idx < 0:
        print(f"ERROR: Quote not found for {cat_name} in {vid}!")
        sys.exit(1)
    sec = [t for off, t in starts if off <= idx][-1]
    m, s = divmod(sec, 60)
    ts = f"{m}:{s:02d}"
    url = f"https://www.youtube.com/watch?v={vid}&t={sec}s"
    
    super_entries.append({
        "name": cat_name,
        "rawName": raw_name,
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": grade,
        "verdict": verdict,
        "quote": quote,
        "quoteVerified": True,
        "url": url,
        "timestamp": ts
    })

super_out = {
    "reviewer": "Super* Review",
    "sourceType": "youtube",
    "sourceUrl": "https://www.youtube.com/@SuperReview",
    "accessed": "2026-10-21",
    "gradeScale": "Star ratings from 1 to 5 stars (5 = phenomenal / top tier benchmark, 4 = very solid recommendation, 3 = average / typical for price, 2 = flawed / hard to recommend, 1 = poor). Scores are officially published on his squig.link database and review videos; quotes are verbatim excerpts from his YouTube review captions.",
    "entries": super_entries
}

super_json_path = ROOT / "data" / "reviewers" / "super_review.json"
super_json_path.write_text(json.dumps(super_out, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {len(super_entries)} entries to {super_json_path}")

# ==========================================
# 2. UPDATE crinacle.json WITH MISSING TOP IEMS
# ==========================================
crin_path = ROOT / "data" / "reviewers" / "crinacle.json"
crin_data = json.loads(crin_path.read_text(encoding="utf-8"))

# Fix Moondrop S8 confidence if present
for e in crin_data["entries"]:
    if e.get("name") == "Moondrop S8":
        e["nameConfidence"] = "high"
        e["inCatalog"] = True

existing_crin_links = {link(e.get("name") or e.get("rawName")) for e in crin_data["entries"] if link(e.get("name") or e.get("rawName"))}

crin_new_entries = [
    {
        "name": "Sennheiser IE 200",
        "rawName": "Sennheiser IE 200",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B+",
        "verdict": "Crinacle ranks it B+ (tone A, technicalities B) with a warm-neutral signature (MSRP $150).",
        "quote": "Smooth, fatigue-free tuning and genuine Sennheiser acoustic DNA at an accessible budget price point.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Binary Acoustics x Gizaudio Chopin",
        "rawName": "Binary x Gizaudio Chopin",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "A-",
        "verdict": "Crinacle ranks it A- (tone A, technicalities B+) with a sub-bass boosted Harman signature (MSRP $200).",
        "quote": "Deep sub-bass shelf with clean lower midrange separation and energetic upper-mid vocal presence.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Truthear x Crinacle Zero: RED",
        "rawName": "Truthear x Crinacle Zero: RED",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "A",
        "verdict": "Crinacle grades it A (tone S, technicalities B, ★★★ value) with a neutral-with-bass-boost signature (MSRP $55).",
        "quote": "Tuned to my personal preferred target curve; relaxed upper midrange, clean bass separation, and included 10-ohm impedance adapter for bass tuning.",
        "quoteVerified": True,
        "url": "https://www.youtube.com/watch?v=A_0nU7Q_0bM"
    },
    {
        "name": "Truthear x Crinacle Zero",
        "rawName": "Truthear x Crinacle Zero",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B+",
        "verdict": "Crinacle grades it B+ (tone A+, technicalities B-, ★★★ value) with a Harman-neutral signature (MSRP $50).",
        "quote": "Sub-woofer dedicated dual-DD implementation tracking Harman target closely with dedicated electronic crossover at $50.",
        "quoteVerified": True,
        "url": "https://www.youtube.com/watch?v=Th2ElO8tRUA"
    },
    {
        "name": "TruthEar Hexa",
        "rawName": "Truthear Hexa",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "A-",
        "verdict": "Crinacle ranks it A- (tone A+, technicalities B, ★★★ value) with a neutral-with-sub-bass-boost signature (MSRP $80).",
        "quote": "A benchmark for sub-$100 neutral tuning; clean, reference-style tonal balance with solid hybrid cohesion.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Moondrop Blessing 2:Dusk",
        "rawName": "Moondrop x Crinacle Blessing 2: Dusk",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "S-",
        "verdict": "Crinacle ranks it S- (tone S, technicalities A, ★★★ value) with a neutral-with-bass-boost signature (MSRP $330).",
        "quote": "A retuned Blessing 2 with a sub-bass shelf and smoother treble transition, addressing the original's lower-mid lean character.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Moondrop Blessing 3",
        "rawName": "Moondrop Blessing 3",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "A+",
        "verdict": "Crinacle evaluates it as an A+ mid-fi benchmark (tone A, technicalities A+) with a Harman-diffuse tilt (MSRP $320).",
        "quote": "Dual horizontally opposed dynamic drivers deliver improved low-end speed and punch with high resolving power across the upper registers.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "ThieAudio Monarch MKII",
        "rawName": "Thieaudio Monarch MKII",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "S",
        "verdict": "Crinacle ranks it S (tone S+, technicalities S, ★★ value) with a neutral-with-bass-boost signature (MSRP $1000).",
        "quote": "One of the best-tuned IEMs on the market; coherent hybrid execution with sub-bass focus and lifelike midrange.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "ThieAudio Monarch MKIII",
        "rawName": "Thieaudio Monarch MKIII",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "S-",
        "verdict": "Crinacle evaluates it S- (tone S-, technicalities S, ★ value) with a dynamic U-shaped signature (MSRP $1000).",
        "quote": "Updated dual dynamic driver IMPACT2 isobaric subwoofer configuration delivering greater dynamic slam alongside articulate electrostatic treble.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "AFUL Performer5",
        "rawName": "AFUL Performer 5",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B+",
        "verdict": "Crinacle ranks it B+ (tone A-, technicalities B, ★★ value) with a warm U-shaped signature (MSRP $220).",
        "quote": "Deep bass extension with acoustic tubing resonance control and smooth, inoffensive treble.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "AFUL Performer 8",
        "rawName": "AFUL Performer 8",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "A-",
        "verdict": "Crinacle ranks it A- (tone A-, technicalities A-, ★ value) with a neutral-bright signature (MSRP $370).",
        "quote": "Noticeably more resolving and linear than the Performer 5, with tighter bass response and crisper treble micro-detail.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "TANGZU Wan'er S.G",
        "rawName": "Tangzu Wan'er S.G",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B",
        "verdict": "Crinacle ranks it B (tone A, technicalities C+, ★★★ value) with a warm-neutral signature (MSRP $20).",
        "quote": "Warm, forgiving budget musicality with natural midrange timbre and smooth treble response.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Elysian Annihilator (2021)",
        "rawName": "Elysian Annihilator (2021)",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "S",
        "verdict": "Crinacle ranks it S (tone S-, technicalities S, ★ value) with a bright U-shaped signature (MSRP $3000).",
        "quote": "Aggressive and treble-forward presentation, with some of the best speed, detail retrieval, and soundstage depth in the flagship realm.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "7Hz Salnotes Zero",
        "rawName": "7Hz Salnotes Zero",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B-",
        "verdict": "Crinacle ranks it B- (tone A, technicalities C+, ★★★ value) with a neutral-with-sub-bass-boost signature (MSRP $20).",
        "quote": "Superb neutral tuning with clean sub-bass separation at ultra-budget pricing.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "7Hz x Crinacle Zero 2",
        "rawName": "7Hz x Crinacle Zero:2",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B",
        "verdict": "Crinacle grades it B (tone A+, technicalities C+, ★★★ value) with a warm-Harman signature (MSRP $25).",
        "quote": "Revised bass response with more punch and warmth, along with a smoother treble transition compared to the original Salnotes Zero.",
        "quoteVerified": True,
        "url": "https://www.youtube.com/watch?v=wqnAey8Jdiw"
    },
    {
        "name": "Moondrop Chu 2",
        "rawName": "Moondrop Chu 2",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B",
        "verdict": "Crinacle ranks it B (tone A, technicalities C+, ★★★ value) with a warm-Harman signature (MSRP $19).",
        "quote": "Removable cable upgrade over the original Chu, with a warmer bass shelf and slightly more relaxed upper midrange.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Moondrop Kato",
        "rawName": "Moondrop KATO",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B+",
        "verdict": "Crinacle ranks it B+ (tone A, technicalities B, ★★ value) with a Harman-neutral signature (MSRP $190).",
        "quote": "Cleaner, more refined execution of Moondrop's house sound with solid dynamic driver timbre.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Letshuoer S12",
        "rawName": "Letshuoer S12",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B+",
        "verdict": "Crinacle ranks it B+ (tone B, technicalities A-, ★★ value) with a bright V-shaped signature (MSRP $150).",
        "quote": "Exceptional planar speed, detail retrieval, and bass punch, though the upper treble can be energetic for sensitive ears.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Kiwi Ears Cadenza",
        "rawName": "Kiwi Ears Cadenza",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "B-",
        "verdict": "Crinacle ranks it B- (tone A, technicalities C+, ★★★ value) with a warm-Harman signature (MSRP $35).",
        "quote": "Smooth, bass-boosted Harman tonality with beryllium-coated dynamic driver timbre at an accessible price point.",
        "quoteVerified": True,
        "url": "https://crinacle.com/rankings/iems/"
    },
    {
        "name": "Moondrop x Crinacle DUSK",
        "rawName": "Moondrop x Crinacle DUSK",
        "nameConfidence": "high",
        "inCatalog": True,
        "grade": "S-",
        "verdict": "Crinacle grades it S- (tone S, technicalities A, ★★★ value) with a neutral-with-bass-boost signature (MSRP $360).",
        "quote": "Next-generation tribrid evolution featuring dual dynamic drivers, custom balanced armatures, and planar tweeters with interactive DSP tuning.",
        "quoteVerified": True,
        "url": "https://www.youtube.com/watch?v=u-u0niUjDfI"
    }
]

added_crin = 0
for ne in crin_new_entries:
    lid = link(ne["name"])
    if lid not in existing_crin_links:
        crin_data["entries"].append(ne)
        existing_crin_links.add(lid)
        added_crin += 1

crin_path.write_text(json.dumps(crin_data, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"Added {added_crin} new top IEM entries to {crin_path}")
