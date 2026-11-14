"""Write research_notes/lossless_checklist.html: all songs in songs/manifest.json, showing which ones have a
FLAC in songs/lossless, which are left, and the real quality of each file.

- Status and quality come from research_notes/lossless_audit.json, a snapshot of a full decode of every FLAC
  (MD5, true bit depth, spectrum) whose song links were reviewed by hand. A new file needs a new audit entry.
- Ticks are yours: saved in the browser (localStorage), so they survive closing the page.
- Each song left links to a store search (Qobuz, Bandcamp).

Usage: python -I scripts/make_checklist.py
"""
import html
import json
from pathlib import Path
from urllib.parse import quote_plus

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "songs" / "manifest.json"
AUDIT = ROOT / "research_notes" / "lossless_audit.json"
OUT = ROOT / "research_notes" / "lossless_checklist.html"
STATUS = {"have": "✓ Have", "check": "Listen", "left": "Left"}
FLAGS = {"padded": "really 16-bit", "upsampled": "44.1 kHz source", "lossy": "possibly from a lossy source"}


def quality(e):
    """'24-bit · 96 kHz', plus what the audit found when the label flatters the file."""
    rate = e["rate"] / 1000
    text = f"{e['bits']}-bit · {rate:g} kHz"
    cls = "hi" if e["bits"] == 24 and not e["flags"] else ""
    flags = "".join(f'<div class="flag">{FLAGS[f]}</div>' for f in e["flags"])
    return f'<span class="{cls}" title="{html.escape(e["file"])}">{text}</span>{flags}'


def main():
    songs = json.loads(MANIFEST.read_text(encoding="utf-8"))["songs"]
    audit = json.loads(AUDIT.read_text(encoding="utf-8"))
    by_id = {e["id"]: e for e in audit["songs"]}
    rows = []
    for s in songs:
        e = by_id[s["id"]]
        status = e["status"]
        q = quote_plus(f"{s['artist']} {s['title']}")
        buy = (
            f'<a href="https://www.qobuz.com/search?q={q}" target="_blank" rel="noreferrer">Qobuz</a> · '
            f'<a href="https://bandcamp.com/search?q={q}" target="_blank" rel="noreferrer">Bandcamp</a>'
            if status == "left"
            else ""
        )
        rows.append(
            f'<tr data-id="{html.escape(s["id"])}" data-cat="{s["category"]}" data-status="{status}">'
            f'<td><input type="checkbox" aria-label="Tick {html.escape(s["title"])}"></td>'
            f"<td>{html.escape(s['artist'])}</td>"
            f"<td>{html.escape(s['title'])}</td>"
            f"<td>{html.escape(str(s.get('album') or ''))}</td>"
            f"<td>{s['category']}</td>"
            f'<td class="st {status}">{STATUS[status]}</td>'
            f"<td>{quality(e) if 'file' in e else ''}</td>"
            f"<td>{html.escape('; '.join(e.get('notes', [])))}</td>"
            f"<td>{buy}</td>"
            "</tr>"
        )
    extras = "\n".join(
        f"<tr><td>{html.escape(x['file'][:-5])}</td><td>{quality(x)}</td></tr>" for x in audit["extras"]
    )
    count = lambda k: sum(e["status"] == k for e in audit["songs"])
    page = (
        TEMPLATE.replace("{{ROWS}}", "\n".join(rows))
        .replace("{{TOTAL}}", str(len(songs)))
        .replace("{{HAVE}}", str(count("have") + count("check")))
        .replace("{{CHECK}}", str(count("check")))
        .replace("{{LEFT}}", str(count("left")))
        .replace("{{EXTRAS}}", extras)
        .replace("{{NEXTRAS}}", str(len(audit["extras"])))
    )
    OUT.write_text(page, encoding="utf-8")
    print(f"{len(songs)} songs: {count('have')} have, {count('check')} to listen to, {count('left')} left -> {OUT}")


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lossless checklist</title>
<style>
  :root { color-scheme: light dark; --line: #8884; --done: #2a9d5c; }
  body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; }
  header { position: sticky; top: 0; background: Canvas; padding: 8px 0; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; border-bottom: 1px solid var(--line); }
  h1 { font-size: 18px; margin: 0 12px 0 0; }
  .bar { flex: 1 1 200px; height: 10px; border-radius: 5px; background: var(--line); overflow: hidden; }
  .bar > div { height: 100%; background: var(--done); width: 0; }
  input[type=search] { padding: 6px 8px; min-width: 200px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { position: sticky; top: 52px; background: Canvas; }
  tr.done td:not(:first-child) { opacity: 0.5; }
  td.st { font-weight: 600; white-space: nowrap; }
  td.have, .hi { color: var(--done); }
  td.check, .flag { color: #c98a12; }
  td.left { color: #d0504a; }
  .flag { font-size: 12px; }
  span[title] { white-space: nowrap; }
  h2 { font-size: 16px; margin: 24px 0 0; }
  input[type=checkbox] { width: 18px; height: 18px; }
  .muted { opacity: 0.7; }
</style>
</head>
<body>
<header>
  <h1>Lossless checklist</h1>
  <span id="count"></span>
  <div class="bar"><div id="fill"></div></div>
  <input type="search" id="q" placeholder="Search artist, title, album">
  <select id="show">
    <option value="left" selected>Left</option>
    <option value="check">Listen: version or length differs</option>
    <option value="have">Have</option>
    <option value="all">All</option>
    <option value="done">Ticked</option>
  </select>
  <select id="cat">
    <option value="">All categories</option>
    <option>bass</option><option>vocals</option><option>treble</option>
    <option>acoustic</option><option>stage</option><option>busy</option>
  </select>
  <span class="muted">ticks save in this browser</span>
</header>
<table>
  <thead><tr><th>✓</th><th>Artist</th><th>Title</th><th>Album</th><th>Category</th><th>Status</th><th>Quality</th><th>Note</th><th>Buy</th></tr></thead>
  <tbody>
{{ROWS}}
  </tbody>
</table>
<h2>In songs/lossless but not in the song list ({{NEXTRAS}})</h2>
<table>
  <thead><tr><th>File</th><th>Quality</th></tr></thead>
  <tbody id="extras">
{{EXTRAS}}
  </tbody>
</table>
<script>
  const KEY = 'lossless-checklist-v1'
  const ticked = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'))
  const rows = [...document.querySelectorAll('tr[data-id]')]
  function save() { localStorage.setItem(KEY, JSON.stringify([...ticked])) }
  function refresh() {
    const q = document.getElementById('q').value.toLowerCase()
    const show = document.getElementById('show').value
    const cat = document.getElementById('cat').value
    for (const r of rows) {
      const on = ticked.has(r.dataset.id)
      r.classList.toggle('done', on)
      r.querySelector('input').checked = on
      const fits = show === 'all' || (show === 'done' ? on : r.dataset.status === show)
      const hit = (!q || r.textContent.toLowerCase().includes(q)) && (!cat || r.dataset.cat === cat) && fits
      r.hidden = !hit
    }
    document.getElementById('count').textContent = '{{HAVE}} / {{TOTAL}} have a FLAC · {{CHECK}} to listen to · {{LEFT}} left'
    document.getElementById('fill').style.width = (100 * {{HAVE}} / {{TOTAL}}) + '%'
  }
  for (const r of rows) r.querySelector('input').addEventListener('change', (e) => {
    e.target.checked ? ticked.add(r.dataset.id) : ticked.delete(r.dataset.id)
    save(); refresh()
  })
  for (const id of ['q', 'show', 'cat']) document.getElementById(id).addEventListener('input', refresh)
  refresh()
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
