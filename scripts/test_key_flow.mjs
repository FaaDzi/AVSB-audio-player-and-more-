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
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_key_' + Date.now(),
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

  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(2500)

  async function evalCode(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return r.result?.result?.value
  }

  // Pre-seed saved profile
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
  await sleep(2000)

  console.log('Sending key "1" for START...')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '1', unmodifiedText: '1', key: '1', code: 'Digit1' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', text: '1', unmodifiedText: '1', key: '1', code: 'Digit1' })
  await sleep(1000)

  console.log('After Key 1, text:\n', await evalCode(`document.body.innerText.slice(0, 500)`))

  // If modal opened, press Enter or click .paper-stamp-btn
  console.log('Dispatching click to .paper-stamp-btn...')
  await evalCode(`
    const btn = document.querySelector('.paper-stamp-btn');
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  `)
  await sleep(1500)
  console.log('After modal click, text:\n', await evalCode(`document.body.innerText.slice(0, 500)`))

  // Screenshot candidates screen
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT_DIR}\\headphone_real_step0_candidates.png`, Buffer.from(s.result.data, 'base64'))

  edge.kill()
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

