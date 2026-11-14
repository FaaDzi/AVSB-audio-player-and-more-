import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.iemranking.com/show/night-oblivion-butastur"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # let's look for reviewer comments/cards
    # extract reviewer names and quotes
    cards = re.findall(r'<div class="review-card"[^>]*>(.*?)</div>\s*</div>', html, re.DOTALL)
    print("Review cards:", len(cards))
    if not cards:
        # let's find blocks mentioning reviewer names
        for rev in ["Precog", "Jays Audio", "Jaytiss", "Shuwa"]:
            pos = html.find(rev)
            if pos != -1:
                print(f"=== Found {rev} ===")
                snippet = html[pos:pos+600]
                # strip html tags
                clean_text = re.sub(r'<[^>]+>', ' ', snippet)
                clean_text = ' '.join(clean_text.split())
                print(clean_text[:400])

