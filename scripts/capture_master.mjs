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
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_master_' + Date.now(),
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

  // Pre-seed saved profile
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
  await sleep(2200)

  // Trigger Start
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '1', unmodifiedText: '1', key: '1', code: 'Digit1' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', text: '1', unmodifiedText: '1', key: '1', code: 'Digit1' })
  await sleep(800)

  // Click .paper-stamp-btn
  await evalCode(`
    const btn = document.querySelector('.paper-stamp-btn');
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  `)
  await sleep(1500)

  // 1. Step 0: Initial choice
  await capture('headphone_review_01_step0_choice.png')

  // Click "Open back" filter
  console.log('Selecting Open back in Step 0...')
  await evalCode(`
    const chips = Array.from(document.querySelectorAll('.hp-type-row button'));
    const ob = chips.find(c => c.innerText.includes('Open back'));
    if (ob) ob.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  `)
  await sleep(1000)
  await capture('headphone_review_02_step0_open_back_selected.png')

  // Click "Continue with Headphones →"
  console.log('Clicking Continue with Headphones...')
  await evalCode(`
    const btns = Array.from(document.querySelectorAll('button'));
    const cont = btns.find(b => b.innerText.includes('Continue with Headphones'));
    if (cont) cont.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  `)
  await sleep(1200)
  await capture('headphone_review_03_step1_bracket_size.png')

  // Click 8 Contenders
  console.log('Selecting 8 Contenders...')
  await evalCode(`
    const cards = Array.from(document.querySelectorAll('.size-big-btn'));
    const s8 = cards.find(c => c.innerText.trim().startsWith('8'));
    if (s8) s8.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  `)
  await sleep(1200)
  await capture('headphone_review_04_step2_who_picks.png')

  // Click "Let the Game Pick"
  console.log('Clicking Let the Game Pick...')
  await evalCode(`
    const cards = Array.from(document.querySelectorAll('.size-big-btn'));
    const auto = cards.find(c => c.innerText.includes('Let the Game Pick'));
    if (auto) auto.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  `)
  await sleep(2500)
  console.log('Roster title:', await evalCode(`document.querySelector('.setup-heading')?.innerText`))
  await capture('headphone_review_05_step3_headphone_roster.png')

  edge.kill()
  console.log('MASTER CAPTURE FINISHED!')
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

