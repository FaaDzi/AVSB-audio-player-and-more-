import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const OUT_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced'

mkdirSync(OUT_DIR, { recursive: true })

const proc = spawn(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_tournament_profile',
  'http://127.0.0.1:5173/'
], { detached: false })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      if (list && list[0] && list[0].webSocketDebuggerUrl) {
        return list[0].webSocketDebuggerUrl
      }
    } catch {}
    await sleep(250)
  }
  throw new Error('Could not connect to Edge DevTools port')
}

async function main() {
  try {
    const wsUrl = await getWsUrl()
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })

    let id = 1
    const pending = new Map()
    ws.onmessage = (event) => {
      try {
        const text = typeof event.data === 'string' ? event.data : event.data.toString('utf-8')
        const msg = JSON.parse(text)
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg)
          pending.delete(msg.id)
        }
      } catch (e) {}
    }

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const msgId = id++
        pending.set(msgId, resolve)
        ws.send(JSON.stringify({ id: msgId, method, params }))
      })
    }

    await send('Page.enable')
    await send('Runtime.enable')

    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false
    })

    await sleep(2000)

    async function capture(filename) {
      console.log('Capturing:', filename)
      const res = await send('Page.captureScreenshot', { format: 'png' })
      if (!res.result || !res.result.data) return
      const filepath = path.join(OUT_DIR, filename)
      writeFileSync(filepath, Buffer.from(res.result.data, 'base64'))
      console.log('Saved:', filename)
    }

    async function evalCode(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
      return r.result?.value
    }

    // Set localStorage prefs so we are in tournament mode or jump straight to tournament step 'kind'
    await evalCode(`
      const p = JSON.parse(localStorage.getItem('iem-prefs') || '{}');
      p.listeningOn = 'headphones';
      p.currentId = 'hp-sennheiser-hd600';
      localStorage.setItem('iem-prefs', JSON.stringify(p));
      location.reload();
    `)
    await sleep(2500)

    // Click "Tournament" button
    console.log('Clicking Tournament / Start Bracket...')
    await evalCode(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Tournament') || x.innerText.includes('Battle') || x.innerText.includes('Bracket') || x.innerText.includes('Enter the'));
      if (b) b.click();
    `)
    await sleep(1500)
    await capture('hp_ui_10_tournament_step0_kind.png')

    // Click "HEADPHONES" big card
    console.log('Selecting HEADPHONES category...')
    await evalCode(`
      const btn = Array.from(document.querySelectorAll('.size-big-btn, button')).find(x => x.innerText.includes('HEADPHONES'));
      if (btn) btn.click();
    `)
    await sleep(1000)
    await capture('hp_ui_11_tournament_hp_selected.png')

    // Click Open back / Closed back / On-ear
    console.log('Selecting Open Back...')
    await evalCode(`
      const ob = Array.from(document.querySelectorAll('.hp-type-row button')).find(x => x.innerText.includes('Open back'));
      if (ob) ob.click();
    `)
    await sleep(800)
    await capture('hp_ui_12_tournament_open_back.png')

    // Click Continue to see Roster builder with headphones!
    console.log('Advancing to size/roster...')
    await evalCode(`
      const cbtn = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Continue'));
      if (cbtn) cbtn.click();
    `)
    await sleep(1000)
    await capture('hp_ui_13_tournament_size.png')

    await evalCode(`
      const sbtn = Array.from(document.querySelectorAll('.size-big-btn, button')).find(x => x.innerText.includes('8') || x.innerText.includes('QUICK'));
      if (sbtn) sbtn.click();
    `)
    await sleep(1500)
    await capture('hp_ui_14_tournament_headphone_roster.png')

    ws.close()
    console.log('Tournament captures complete!')
  } finally {
    proc.kill()
  }
}

main().catch(err => {
  console.error('Error:', err)
  proc.kill()
  process.exit(1)
})

