import urllib.request
import urllib.parse
import json
import re
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def search_ddg_images(query):
    url = f"https://duckduckgo.com/?q={urllib.parse.quote(query)}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
    try:
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            content = r.read().decode('utf-8', errors='ignore')
            vqd_match = re.search(r'vqd=([\'"]?)([\d-]+)\1', content)
            if not vqd_match:
                return []
            vqd = vqd_match.group(2)
            
        i_url = f"https://duckduckgo.com/i.js?l=us-en&o=json&q={urllib.parse.quote(query)}&vqd={vqd}&f=,,,&p=1"
        i_req = urllib.request.Request(i_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://duckduckgo.com/'
        })
        with urllib.request.urlopen(i_req, timeout=10, context=ctx) as ir:
            data = json.loads(ir.read().decode('utf-8'))
            return [res['image'] for res in data.get('results', [])[:5]]
    except Exception as e:
        print("Error:", e)
        return []

urls = search_ddg_images("Apple AirPods Max headphones product isolated")
print("Found URLs:", len(urls))
for u in urls:
    print(" ", u)

