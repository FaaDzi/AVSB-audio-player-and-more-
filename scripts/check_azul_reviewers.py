import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.iemranking.com/show/prisma-audio-azul"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # find reviewer names and scores
    reviewers = re.findall(r'alt="([^"]+)"[^>]*style="[^"]*border-radius: 50%', html)
    print("Reviewers:", reviewers)
    # search for score progress-bar
    scores = re.findall(r'title="([^"]+)"', html)
    for s in scores:
        if any(r in s for r in ["Precog", "Crinacle", "Jay", "Super", "Antdroid"]):
            print("  Score:", s)

