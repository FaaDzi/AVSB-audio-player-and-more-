"""Shops with public Shopify product feeds, used for IEM photos and prices.

Order matters: for photos, brand shops come first (official shots of the IEM itself),
then retailers. Prices are only taken from USD shops.
"""

# (domain, kind, currency)
STORES = [
    # brand shops
    ("kiwiears.com", "brand", "USD"),
    ("letshuoer.net", "brand", "USD"),
    ("tangzu.net", "brand", "USD"),
    ("ziigaat.com", "brand", "USD"),
    ("www.thieaudio.com", "brand", "USD"),
    ("www.tripowin.com", "brand", "USD"),
    ("www.hisenior-iem.com", "brand", "USD"),
    ("www.nicehck.com", "brand", "USD"),
    ("epzaudio.com", "brand", "USD"),
    ("www.campfireaudio.com", "brand", "USD"),
    ("www.64audio.com", "brand", "USD"),
    ("www.etymotic.com", "brand", "USD"),
    ("www.westoneaudio.com", "brand", "USD"),
    ("www.kineraaudio.com", "brand", "USD"),
    ("fatfreq.com", "brand", "USD"),
    ("www.hiby.com", "brand", "USD"),
    # headphone and TWS makers (added for headphone photos, §34)
    ("www.audeze.com", "brand", "USD"),
    ("mezeaudio.com", "brand", "unknown"),
    ("www.koss.com", "brand", "USD"),
    ("abyss-headphones.com", "brand", "USD"),
    ("www.hedd.audio", "brand", "EUR"),
    ("www.skullcandy.com", "brand", "USD"),
    ("us.soundcore.com", "brand", "USD"),
    ("www.nothing.tech", "brand", "unknown"),
    # retailers
    ("linsoul.com", "retail", "USD"),
    ("hifigo.com", "retail", "USD"),
    ("shenzhenaudio.com", "retail", "USD"),
    ("apos.audio", "retail", "USD"),
    ("headphones.com", "retail", "USD"),
    ("shop.musicteck.com", "retail", "USD"),
    ("www.audio46.com", "retail", "USD"),
    ("www.bloomaudio.com", "retail", "USD"),
    ("www.moon-audio.com", "retail", "USD"),
    ("www.audiocubes.com", "retail", "USD"),
    ("www.headphonezone.in", "retail", "INR"),
    ("www.hifiheadphones.co.uk", "retail", "GBP"),
    ("keephifi.com", "retail", "USD"),
    ("www.audioadvice.com", "retail", "USD"),
    ("www.hifi-express.com", "retail", "unknown"),
    ("www.addictedtoaudio.com.au", "retail", "AUD"),
    ("headamp.com", "retail", "USD"),
]
DOMAINS = [s[0] for s in STORES]
USD = {s[0] for s in STORES if s[2] == "USD"}
