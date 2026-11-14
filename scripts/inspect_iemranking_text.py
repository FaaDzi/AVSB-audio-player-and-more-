import urllib.request
import ssl
import re

ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

url = "https://www.iemranking.com/show/night-oblivion-butastur"
req = urllib.request.Request(url, headers={"User-Agent": UA})
with urllib.request.urlopen(req, context=ctx) as r:
    html = r.read().decode("utf-8", errors="ignore")
    # let's look for blockquotes, comments, descriptions
    quotes = re.findall(r'<blockquote[^>]*>(.*?)</blockquote>', html, re.DOTALL)
    print("Blockquotes:", len(quotes))
    for q in quotes:
        print(re.sub(r'<[^>]+>', '', q).strip())
    # look for review text / comment text
    comments = re.findall(r'class="[^"]*comment[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    print("Comments:", len(comments))
    for c in comments:
        print(re.sub(r'<[^>]+>', '', c).strip())
    # find all review rows/items
    rows = re.findall(r'class="reviewer[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    print("Reviewer items:", len(rows))
    for r in rows[:5]:
        print(" ", re.sub(r'<[^>]+>', ' ', r).strip())

