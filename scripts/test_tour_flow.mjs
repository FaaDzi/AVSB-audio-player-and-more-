import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const OUT_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_tour2_' + Date.now(),
  'about:blank'
])

async function run() {
  await sleep(1000)
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension://'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.onopen = r)

  let id = 1
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (m, p = {}) => new Promise((r) => {
    const i = id++
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })

  async function evalCode(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return r.result?.result?.value
  }

  async function capture(filename) {
    console.log(`[SNAP] Capturing: ${filename}`)
    await sleep(400)
    const s = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${OUT_DIR}\\${filename}`, Buffer.from(s.result.data, 'base64'))
    console.log(`[SNAP] Saved: ${filename}`)
  }

  // Pre-seed localStorage
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(1500)
  await evalCode(`
    localStorage.setItem('iem-prefs-v1', JSON.stringify({
      currentId: 'tangzu-waner-s.g',
      listeningOn: 'iem',
      mode: 'iem',
      budget: [0, 500],
      flavour: 'neutral',
      compare: 'iems',
      hpType: 'any',
      blind: true
    }));
  `)
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(2500)

  // Click START
  console.log('Clicking START...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('START'));
    if (b) b.click();
  `)
  await sleep(1500)

  // Click .paper-stamp-btn in modal
  console.log('Clicking .paper-stamp-btn...')
  await evalCode(`
    const b = document.querySelector('.paper-stamp-btn');
    if (b) b.click();
  `)
  await sleep(2000)

  console.log('Candidates Step 0 text:\n', await evalCode(`document.body.innerText.slice(0, 500)`))
  await capture('headphone_step0_kind_choice.png')

  // Click HEADPHONES card in Step 0
  console.log('Clicking HEADPHONES card...')
  await evalCode(`
    const cards = Array.from(document.querySelectorAll('.size-big-btn'));
    const hp = cards.find(c => c.innerText.includes('HEADPHONES'));
    if (hp) hp.click();
  `)
  await sleep(1500)
  console.log('After HEADPHONES click, text:\n', await evalCode(`document.body.innerText.slice(0, 400)`))
  await capture('headphone_step1_size_choice.png')

  // Click 8 Contenders
  console.log('Clicking 8 Contenders...')
  await evalCode(`
    const cards = Array.from(document.querySelectorAll('.size-big-btn'));
    const s8 = cards.find(c => c.innerText.trim().startsWith('8'));
    if (s8) s8.click();
  `)
  await sleep(1500)
  await capture('headphone_step2_who_picks.png')

  // Click "Let the Game Pick"
  console.log('Clicking Let the Game Pick...')
  await evalCode(`
    const cards = Array.from(document.querySelectorAll('.size-big-btn'));
    const auto = cards.find(c => c.innerText.includes('Let the Game Pick'));
    if (auto) auto.click();
  `)
  await sleep(2500)
  console.log('Roster screen text:\n', await evalCode(`document.body.innerText.slice(0, 500)`))
  await capture('headphone_step3_headphone_roster.png')

  edge.kill()
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

