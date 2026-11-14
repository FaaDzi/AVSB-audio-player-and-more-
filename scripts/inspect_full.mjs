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
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_full_' + Date.now(),
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
    console.log(`Capturing: ${filename}`)
    await sleep(400)
    const s = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${OUT_DIR}\\${filename}`, Buffer.from(s.result.data, 'base64'))
    console.log(`Saved: ${filename}`)
  }

  // Pre-seed localStorage with realistic IEM setup so ear-gain & headphone tournament are enabled
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(1500)
  await evalCode(`
    localStorage.setItem('iem-prefs-v1', JSON.stringify({
      currentId: 'tangzu-waner-s.g',
      listeningOn: 'iem',
      mode: 'iem',
      budget: [0, 500],
      flavour: 'neutral',
      compare: 'headphones',
      hpType: 'any',
      blind: true
    }));
  `)
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(2200)

  // 1. SETTINGS: Tests List & Ear Gain Slider
  console.log('Navigating to SETTINGS...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('SETTINGS'));
    if (b) b.click();
  `)
  await sleep(1500)

  console.log('Clicking Test your gear...')
  await evalCode(`
    const rows = Array.from(document.querySelectorAll('.set-nav-row'));
    const t = rows.find(r => r.innerText.includes('Test your gear'));
    if (t) t.click();
  `)
  await sleep(1000)
  await capture('headphone_live_01_settings_tests.png')

  console.log('Clicking Fit & seal...')
  await evalCode(`
    const cards = Array.from(document.querySelectorAll('.set-test-card, button'));
    const fit = cards.find(c => c.innerText.includes('Fit & seal'));
    if (fit) fit.click();
  `)
  await sleep(1200)
  await capture('headphone_live_02_settings_eargain_slider.png')

  // Back to tests, then click Hearing check
  await evalCode(`
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('←') || x.innerText.includes('Back') || x.className.includes('back'));
    if (b) b.click();
  `)
  await sleep(800)
  await evalCode(`
    const cards = Array.from(document.querySelectorAll('.set-test-card, button'));
    const hc = cards.find(c => c.innerText.includes('Hearing check'));
    if (hc) hc.click();
  `)
  await sleep(1200)
  await capture('headphone_live_03_settings_hearing_check.png')

  // 2. TOURNAMENT SETUP: Step 0, Step 1, Step 2, Step 3
  console.log('Navigating to Tournament Setup...')
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(2000)

  // Click START
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('START'));
    if (b) b.click();
  `)
  await sleep(1000)

  // In modal: Yes (Skip to Bracket Setup)
  await evalCode(`
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Skip to Bracket Setup') || x.innerText.includes('Yes'));
    if (b) b.click();
  `)
  await sleep(1500)
  await capture('headphone_live_04_tournament_step0_kind.png')

  // Click "Open back" filter in Step 0
  console.log('Clicking Open back filter in Step 0...')
  await evalCode(`
    const chips = Array.from(document.querySelectorAll('.hp-type-row button, button'));
    const ob = chips.find(b => b.innerText.includes('Open back'));
    if (ob) ob.click();
  `)
  await sleep(1000)
  await capture('headphone_live_05_tournament_step0_open_back.png')

  // Click Continue with Headphones
  console.log('Clicking Continue with Headphones...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Continue with Headphones'));
    if (b) b.click();
  `)
  await sleep(1200)
  await capture('headphone_live_06_tournament_step1_size.png')

  // Click 8 Contenders
  console.log('Selecting 8 Contenders...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.size-big-btn, button')).find(x => x.innerText.trim().startsWith('8'));
    if (b) b.click();
  `)
  await sleep(1200)
  await capture('headphone_live_07_tournament_step2_who_picks.png')

  // Click "Let the Game Pick"
  console.log('Clicking Let the Game Pick...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.size-big-btn, button')).find(x => x.innerText.includes('Let the Game Pick') || x.innerText.includes('Auto'));
    if (b) b.click();
  `)
  await sleep(2000)
  await capture('headphone_live_08_tournament_step3_headphone_roster.png')

  edge.kill()
  console.log('ALL LIVE HEADPHONE SCREENS CAPTURED!')
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

